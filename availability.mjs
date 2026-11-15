import { bookingUrl, getHall } from './public/halls.mjs';
import { loadEbusy, loadSportision } from './providers.mjs';
import { euroCents, hourlyPrice, withCourtPrices } from './prices.mjs';
export { getHall };

const hours = Array.from({ length: 24 }, (_, hour) => hour);
const closed = { status: 'closed', courts: [] };

function summarize(courts, otherwise) {
  return courts.length ? { status: 'free', courts } : { status: otherwise, courts: [] };
}

const activeCourtStatuses = {
  available: 'free',
  blocked: 'occupied',
  ordered: 'occupied',
  unAvailable: 'unreleased'
};

function schriesheimRateList(html) {
  const content = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ');
  if (!/Wintersaison\s+1\.\s*Oktober bis 30\.\s*April/i.test(content)) return [];
  const rates = content.match(/Montag bis Freitag:([\s\S]+?)Samstag und Sonntag([\s\S]+?)(?:Die Preise|$)/i);
  if (!rates) return [];
  return rates.slice(1).map(section => Array.from(section.matchAll(
    /(\d{2})\.(\d{2})\s*-\s*(\d{2})\.(\d{2})\s*Uhr\s+(\d+[.,]\d{2})\s*(?:&euro;|€)/g
  ), ([, fromHour, fromMinute, toHour, toMinute, price]) => ({
    start: 60 * Number(fromHour) + Number(fromMinute),
    end: 60 * Number(toHour) + Number(toMinute),
    cents: euroCents(Number(price.replace(',', '.')))
  })));
}

export function parseActiveCourt(html, dates, prices = []) {
  const grid = html.match(/<div class="week-reservations-period-block">\s*<table[^>]*>([\s\S]*?)<\/table>/)?.[1];
  const gridDates = Array.from(grid?.matchAll(/class="week_d_date">\s*(\d{2})\.(\d{2})\.(\d{4})/g) ?? [],
    ([, day, month, year]) => `${year}-${month}-${day}`);
  if (gridDates.join() !== dates.join()) {
    throw new Error('Schriesheim hat für diese Woche keinen passenden Buchungsplan geliefert.');
  }

  const timeRows = Array.from(html.matchAll(/class="week-period-time-title">\s*(\d{2}):(00|30)\s*-\s*\d{2}:\d{2}/g),
    ([, hour, minute]) => Number(hour) * 60 + Number(minute));
  const cellsByTime = Array.from(grid.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g), ([, row]) =>
    Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), ([, cell]) => cell)
  ).slice(1);
  if (!timeRows.length || cellsByTime.length !== timeRows.length ||
      cellsByTime.some(row => row.length !== dates.length) ||
      timeRows.some((minute, index) => index > 0 && minute !== timeRows[index - 1] + 30)) {
    throw new Error('Das Raster aus Schriesheim ist unvollständig.');
  }

  return dates.map((date, day) => {
    const month = Number(date.slice(5, 7));
    const weekday = new Date(date).getUTCDay();
    const rates = month >= 10 || month <= 4 ? prices[Number(weekday === 0 || weekday === 6)] ?? [] : [];
    const rows = cellsByTime.map(row => parseActiveCourtCell(row[day]));
    const courtList = Array.from(rows[0].keys());
    if (rows.some(row => row.size !== courtList.length || courtList.some(court => !row.has(court)))) {
      throw new Error('Die Plätze in Schriesheim stimmen zwischen den Zeilen nicht überein.');
    }
    const slots = new Map(timeRows.map((time, index) => [time, rows[index]]));
    return { date, hours: hours.map(hour => {
      const first = slots.get(hour * 60);
      const second = slots.get(hour * 60 + 30);
      if (!first || !second) return closed;
      const free = courtList.filter(court => first.get(court) === 'free' && second.get(court) === 'free');
      const unreleased = courtList.some(court => {
        const halves = [first.get(court), second.get(court)];
        return halves.includes('unreleased') && !halves.includes('occupied');
      });
      const slot = summarize(free.map(court => `Platz ${court}`), unreleased ? 'unreleased' : 'occupied');
      const price = hourlyPrice(rates, hour * 60);
      return withCourtPrices(slot, free.map(() => price));
    }) };
  });
}

function parseActiveCourtCell(cell) {
  const result = new Map();
  for (const [, attributes, number] of cell.matchAll(/<span([^>]*)>\s*(\d+)\s*<\/span>/g)) {
    const classes = attributes.match(/\bclass="([^"]*)"/)?.[1].trim().split(/\s+/) ?? [];
    if (!classes.includes('week-box')) continue;
    const status = classes.find(name => Object.hasOwn(activeCourtStatuses, name));
    if (!status || result.has(number)) {
      throw new Error('Schriesheim hat einen unbekannten Platzstatus geliefert.');
    }
    result.set(number, activeCourtStatuses[status]);
  }
  if (!result.size) throw new Error('Im Buchungsplan aus Schriesheim fehlen Plätze.');
  return result;
}

function localTimestamp(value) {
  // The tennis04 booking plan carries wall-clock times without a timezone.
  const timestamp = typeof value === 'string' && Date.parse(value.slice(0, 19) + 'Z');
  if (!Number.isFinite(timestamp)) throw new Error('tennis04 hat eine ungültige Uhrzeit geliefert.');
  return timestamp;
}

function tennis04Season(group, date) {
  return group.seasons.find(item => item.seasonBegin.slice(0, 10) <= date &&
    (!item.seasonEnd || item.seasonEnd.slice(0, 10) >= date) &&
    ((item.type === 'Winter' && group.winterVisible) || (item.type === 'Sommer' && group.summerVisible)));
}

function guestRates(legend, weekday) {
  if (legend?.priceUnit !== 60 || legend.eventOccurences != null || !Array.isArray(legend.tariffTable)) return [];
  const guest = legend.tariffTable.filter(tariff => typeof tariff?.group === 'string' &&
    /^(?:gast|gäste|nichtmitglied(?:er)?|guests?)$/i.test(tariff.group.trim()));
  if (guest.length !== 1 || !Array.isArray(guest[0].prices)) return [];

  const minute = value => typeof value === 'string' ? Date.parse(value.slice(0, 19) + 'Z') / 60_000 : NaN;
  return guest[0].prices.filter(price => price?.weekDay === weekday).map(price => {
    const begin = minute(price.beginTime);
    const start = ((begin % 1440) + 1440) % 1440;
    return { start, end: start + minute(price.endTime) - begin, cents: euroCents(price.price) };
  });
}

export function tennis04Hours(group, bookings, dates, legends = new Map()) {
  const courts = new Map(group.courts.map(court => [String(court.id), {
    name: court.title.replace(/^Pl\.\s*(\d+)$/i, 'Platz $1'),
    bookings: []
  }]));
  for (const event of bookings) {
    const start = localTimestamp(event.start);
    const end = localTimestamp(event.end);
    const resources = event.resourceIds?.length ? event.resourceIds : [event.resourceId];
    if (end <= start || !resources.some(id => courts.has(String(id)))) {
      throw new Error('tennis04 hat eine Buchung ohne gültigen Platz oder Zeitraum geliefert.');
    }
    for (const id of resources) courts.get(String(id))?.bookings.push({ start, end });
  }

  const open = group.hourFrom * 60 + group.minuteFrom;
  const closes = (group.hourUntil + 1) * 60 + group.minuteUntil;
  if (!Number.isInteger(open) || !Number.isInteger(closes) || open < 0 || closes > 1440 ||
      open >= closes || !Array.isArray(group.seasons) || !courts.size) {
    throw new Error('tennis04 hat keine gültigen Öffnungszeiten geliefert.');
  }
  return dates.map(date => {
    const season = tennis04Season(group, date);
    const midnight = Date.parse(date + 'T00:00:00Z');
    const rates = guestRates(legends.get(season?.id), new Date(midnight).getUTCDay() || 7);

    return { date, hours: hours.map(hour => {
      const minute = hour * 60;
      if (minute < open || minute + 60 > closes || !season) return closed;
      const start = midnight + minute * 60_000;
      const end = start + 3_600_000;
      const free = Array.from(courts.values())
        .filter(court => !court.bookings.some(booking => booking.start < end && booking.end > start))
        .map(court => court.name);
      const price = hourlyPrice(rates, minute);
      return withCourtPrices(summarize(free, 'occupied'), free.map(() => price));
    }) };
  });
}

async function upstream(url, format, headers = {}, timeout = 12_000) {
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      headers: { accept: format === 'json' ? 'application/json' : 'text/html', ...headers }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response[format]();
  } catch (error) {
    console.error('Abruf fehlgeschlagen:', new URL(url).hostname, error.cause?.code || error.name);
    throw new Error('Der Buchungsplan ist derzeit nicht erreichbar.');
  }
}

function optionalPriceSource(url, format) {
  return upstream(url, format, {}, 8_000).catch(() => null);
}

async function loadTennis04(url, dates) {
  const page = await upstream(url, 'text');
  const id = page.match(/window\[['"]_id['"]\]\s*=\s*(\d+)\s*;/)?.[1];
  if (!id) throw new Error('Der tennis04-Verein konnte nicht ermittelt werden.');

  const base = `https://app.tennis04.com/a/${id}/`;
  const app = optionalPriceSource(base + 'app', 'json');
  const locations = await upstream(base + 'courtgroups', 'json');
  if (!Array.isArray(locations)) throw new Error('Die tennis04-Platzliste konnte nicht gelesen werden.');
  const groups = locations.flatMap(location => location.courtGroups)
    .filter(group => group?.displayRight && group.courts?.length && /halle|indoor/i.test(group.name));
  if (!groups.length) throw new Error('Im öffentlichen tennis04-Buchungsplan ist keine Halle erkennbar.');

  const start = dates[0];
  const end = dates.at(-1);
  const groupDays = await Promise.all(groups.map(async group => {
    const query = new URLSearchParams({ datefrom: start, dateto: end, courtgroup: group.id, useAccountingColors: 'false' });
    const [bookings, legends] = await Promise.all([
      upstream(base + 'bookings?' + query, 'json'),
      app.then(async settings => {
        if (settings?.organisation?.isoCurrency !== 'EUR' || !Array.isArray(group.seasons)) return new Map();
        const seasons = new Set(dates.map(date => tennis04Season(group, date)?.id).filter(Number.isInteger));
        return new Map(await Promise.all([...seasons].map(async id => [id,
          await optionalPriceSource(`${base}courtgroups/${encodeURIComponent(group.id)}/pricelegend?seasonId=${id}`, 'json')
        ])));
      })
    ]);
    if (!Array.isArray(bookings)) throw new Error('Die tennis04-Belegungen konnten nicht gelesen werden.');
    return tennis04Hours(group, bookings, dates, legends);
  }));

  return dates.map((date, day) => ({ date, hours: hours.map(hour => {
    const slots = groupDays.map(group => group[day].hours[hour]);
    const free = slots.flatMap((slot, index) => groups.length === 1 ?
      slot.courts : slot.courts.map(court => `${groups[index].name} · ${court}`));
    const prices = slots.flatMap(slot => slot.courts.map((_, index) => slot.courtPrices?.[index] ?? null));
    return withCourtPrices(summarize(free, slots.some(slot => slot.status === 'occupied') ? 'occupied' : 'closed'), prices);
  }) }));
}

export async function loadAvailability(hall, dates) {
  let days;
  if (hall.provider === 'activecourt') {
    const url = new URL(bookingUrl(hall, dates[0]));
    url.searchParams.set('week', '1');
    url.searchParams.delete('area_id');
    const [grid, prices] = await Promise.all([
      upstream(url, 'text'), optionalPriceSource(new URL('/price.php', url), 'text')
    ]);
    days = parseActiveCourt(grid, dates, schriesheimRateList(prices ?? ''));
  } else if (hall.provider === 'ebusy') {
    days = await loadEbusy(hall, dates, upstream, optionalPriceSource);
  } else if (hall.provider === 'sportision') {
    days = await loadSportision(hall, dates, upstream);
  } else {
    days = await loadTennis04(hall.url, dates);
  }
  return { days, checkedAt: new Date().toISOString() };
}
