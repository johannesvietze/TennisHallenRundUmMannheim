import { addDays } from './public/dates.mjs';
import { bookingUrl, ebusyDate } from './public/halls.mjs';
import { euroCents, hourlyPrice, withCourtPrices } from './prices.mjs';

const minutesPerDay = 1440;
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const otherSports = /squash|padel|badminton|pickleball|tischtennis/i;
const weekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function minutes(time) {
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(time)) {
    throw new Error('Der Anbieter hat eine ungültige Uhrzeit geliefert.');
  }
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function dayMinutes(date) {
  return Date.parse(date + 'T00:00:00Z') / 60_000;
}

function timeRange(from, to) {
  const start = minutes(from);
  const end = minutes(to);
  return { start, end: end < start ? end + minutesPerDay : end };
}

function overlaps(start, end, interval) {
  return interval.start < end && interval.end > start;
}

function coversHour(intervals, start) {
  const end = start + 60;
  let covered = start;
  for (const interval of intervals.filter(item => overlaps(start, end, item)).sort((a, b) => a.start - b.start)) {
    if (interval.start > covered) return false;
    covered = Math.max(covered, interval.end);
    if (covered >= end) return true;
  }
  return false;
}

function hourStatus(courts, unavailable) {
  const free = courts.filter(court => court.status === 'free').map(court => court.name);
  if (free.length) return { status: 'free', courts: free };
  return { status: unavailable.find(status => courts.some(court => court.status === status)) ?? 'closed', courts: [] };
}

function attributes(tag) {
  return Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), ([, key, value]) => [key, value]));
}

function bookingDate(value) {
  const date = typeof value === 'string' && value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!date) throw new Error('eBuSy hat ein ungültiges Buchungsdatum geliefert.');
  return `${date[3]}-${date[1]}-${date[2]}`;
}

export function parseEbusyGrid(html, selectedDate) {
  const date = html.match(/\bcurrentDate:\s*"([^"]+)"/)?.[1];
  const opens = html.match(/\bdayBegin:\s*"([^"]+)"/)?.[1];
  const closes = html.match(/\bdayEnd:\s*"([^"]+)"/)?.[1];
  const single = html.match(/\bsingleBookingAvailable:\s*"(true|false)"/)?.[1];
  if (date !== ebusyDate(selectedDate) || !opens || !closes || !single) {
    throw new Error('eBuSy hat für das gewählte Datum keinen passenden Buchungsplan geliefert.');
  }

  const courts = new Map();
  for (const [, tag, label] of html.matchAll(/<(?:div|th)\b([^>]*\bdata-id="\d+"[^>]*)>\s*(?:<h3 class="court-header">([^<]+)<\/h3>)?/g)) {
    const props = attributes(tag);
    if (!props.class?.split(/\s+/).includes('court')) continue;
    const name = (label ?? props.title)?.trim();
    if (name && !otherSports.test(name)) courts.set(props['data-id'], name);
  }

  const slots = [];
  for (const [, tag] of html.matchAll(/<td\b([^>]*\bdata-court="\d+"[^>]*)>/g)) {
    const props = attributes(tag);
    const court = props['data-court'];
    if (!courts.has(court) || !props['data-minor-begin'] || !props['data-minor-end']) continue;

    // data-date varies by column in the week view, while data-date-iso can repeat.
    const date = bookingDate(props['data-date']);
    const midnight = dayMinutes(date);
    const { start, end } = timeRange(props['data-minor-begin'], props['data-minor-end']);
    if (end <= start) throw new Error('eBuSy hat ein ungültiges Zeitraster geliefert.');
    const classes = props.class?.split(/\s+/) ?? [];
    slots.push({
      date, court, start: midnight + start, end: midnight + end,
      status: classes.includes('slot') ? (single === 'true' ? 'free' : 'unreleased') : 'occupied'
    });
  }
  if (!slots.length || !courts.size) throw new Error('Im eBuSy-Buchungsplan sind keine Tennisplätze erkennbar.');
  return { courts, slots, overnight: minutes(closes) > 0 && minutes(closes) < minutes(opens) };
}

export function ebusyHours(grid, source, dates, prices = new Map()) {
  if (!Array.isArray(source?.reservations) || !Array.isArray(source.courtRelations) ||
      source.suppressedReservationsCount !== 0) {
    throw new Error('eBuSy hat keine vollständige Belegung geliefert.');
  }
  const reservations = new Map();
  const relations = new Map(source.courtRelations.map(relation => [String(relation.court), relation.relatedCourts]));
  for (const reservation of source.reservations) {
    const court = String(reservation.court);
    const affected = reservation.blocksRelatedCourts ? [court, ...(relations.get(court) ?? [])] : [court];
    const midnight = dayMinutes(bookingDate(reservation.date));
    const { start, end } = timeRange(reservation.fromTime, reservation.toTime);
    if (end <= start) throw new Error('eBuSy hat einen ungültigen Belegungszeitraum geliefert.');
    for (const id of affected.map(String)) {
      if (!reservations.has(id)) reservations.set(id, []);
      reservations.get(id).push({ start: midnight + start, end: midnight + end });
    }
  }

  return dates.map(date => {
    const slots = grid.slots.filter(slot => slot.date === date);
    const midnight = dayMinutes(date);
    const weekday = new Date(date).getUTCDay();
    if (![...grid.courts.keys()].every(court => slots.some(slot => slot.court === court))) {
      throw new Error('Im eBuSy-Raster fehlen Plätze für die gewählte Woche.');
    }
    const courts = [...grid.courts].map(([id, name]) => ({
      name, slots: slots.filter(slot => slot.court === id), reservations: reservations.get(id) ?? [],
      rates: prices.get(`${id}:${weekday}`) ?? []
    }));
    return { date, hours: hours.map(hour => {
      const start = midnight + hour * 60;
      const options = courts.map(court => {
        const available = coversHour(court.slots, start);
        let status = 'closed';
        if (available) {
          if (court.reservations.some(item => overlaps(start, start + 60, item)) ||
              court.slots.some(slot => slot.status === 'occupied' && overlaps(start, start + 60, slot))) {
            status = 'occupied';
          } else if (coversHour(court.slots.filter(slot => slot.status === 'free'), start)) {
            status = 'free';
          } else {
            status = 'unreleased';
          }
        }
        return { name: court.name, status, price: status === 'free' ? hourlyPrice(court.rates, hour * 60) : null };
      });
      const slot = hourStatus(options, ['unreleased', 'occupied']);
      return withCourtPrices(slot, options.filter(court => court.status === 'free').map(court => court.price));
    }) };
  });
}

function ebusyTariffs(html, url, fetchPrice) {
  const singleBooking = /^Einzel(?:buchung|stunde)(?:[\s–-]+(?:Winter(?:saison)?|Sommer(?:saison)?))?(?:\s+\d{2,4}(?:\/\d{2,4})?)?$/i;
  const ids = new Set();
  for (const [, id, label] of html.matchAll(/<a\b[^>]*\bhref="[^"<>]*[?&]prices-for=(\d+)(?=[&"])[^"]*"[^>]*>([^<]*)<\/a>/g)) {
    if (singleBooking.test(label.trim())) ids.add(id);
  }

  return Promise.all([...ids].map(async id => {
    if (html.match(/\bpricesFor:\s*"(\d+)"/)?.[1] === id) return { id, html };
    const priceUrl = new URL(url);
    priceUrl.searchParams.set('prices-for', id);
    try {
      return { id, html: await fetchPrice(priceUrl, 'text') };
    } catch {
      return { id, html: null };
    }
  }));
}

function ebusyRates(tariffs, date) {
  const rates = new Map();
  function add(court, day, rate) {
    const key = `${court}:${day}`;
    if (!rates.has(key)) rates.set(key, []);
    rates.get(key).push(rate);
  }

  for (const { id, html } of tariffs) {
    if (html?.match(/\bcurrentDate:\s*"([^"]+)"/)?.[1] !== ebusyDate(date) ||
        html.match(/\bpricesFor:\s*"(\d+)"/)?.[1] !== id) continue;
    const encoded = html.match(/\bpriceZones:\s*("(?:\\.|[^"\\])*")/)?.[1];
    let zones;
    try {
      zones = JSON.parse(JSON.parse(encoded));
    } catch {
      continue;
    }
    if (!Array.isArray(zones)) continue;

    for (const zone of zones) {
      const day = weekdays.indexOf(zone?.weekday);
      if (day < 0 || !Number.isSafeInteger(zone.court) || !/€|\bEUR\b/i.test(zone.priceLong)) continue;
      const cents = euroCents(zone.price);
      if (cents === null) continue;
      let range;
      try {
        range = timeRange(zone.fromTime, zone.toTime);
      } catch {
        continue;
      }
      add(zone.court, day, { ...range, cents });
      if (range.end > minutesPerDay) {
        add(zone.court, (day + 1) % 7, { start: 0, end: range.end - minutesPerDay, cents });
      }
    }
  }
  return rates;
}

export async function loadEbusy(hall, dates, upstream, fetchPrice = upstream) {
  function gridUrl(date, view) {
    const url = new URL(bookingUrl(hall, date));
    url.searchParams.set('view', view);
    return url;
  }

  async function fetchGrid(url, date) {
    const [html, reservations] = await Promise.all([
      upstream(url, 'text'),
      upstream(url, 'json', { 'x-requested-with': 'XMLHttpRequest' })
    ]);
    return { grid: parseEbusyGrid(html, date), reservations, html };
  }

  const first = dates[0];
  const url = gridUrl(first, 'WEEK');
  const { grid, reservations, html } = await fetchGrid(url, first);
  const tariffs = ebusyTariffs(html, url, fetchPrice);
  if (grid.overnight) {
    // The first morning's slots are shown at the end of the previous booking day.
    const previousDay = addDays(first, -1);
    const previous = await fetchGrid(gridUrl(previousDay, 'DAY'), previousDay);
    if (!Array.isArray(reservations.reservations) || !Array.isArray(previous.reservations.reservations) ||
        previous.reservations.suppressedReservationsCount !== 0) {
      throw new Error('eBuSy hat keine vollständige Belegung geliefert.');
    }
    grid.slots.push(...previous.grid.slots.filter(slot => slot.date === first));
    reservations.reservations.push(...previous.reservations.reservations);
  }
  return ebusyHours(grid, reservations, dates, ebusyRates(await tariffs, first));
}

function sportisionDay(response) {
  if (!Array.isArray(response?.data)) throw new Error('Der Sportision-Kalender ist unvollständig.');
  const courts = response.data.filter(court => !court.is_hidden && /halle|indoor/i.test(court.group_name) &&
    !otherSports.test(`${court.group_name} ${court.name}`));
  if (!courts.length) throw new Error('Im öffentlichen Sportision-Kalender sind keine Hallenplätze erkennbar.');

  const day = courts.map(court => {
    if (court.closed) return { ...court, start: 0, end: 0 };
    const opening = timeRange(court.opening_hours?.start, court.opening_hours?.end);
    if (!Array.isArray(court.slots)) throw new Error('Sportision hat kein vollständiges Stundenraster geliefert.');
    const slots = court.slots.map(slot => {
      if (!Number.isInteger(slot.start) || !Number.isInteger(slot.width) || slot.width <= 0 ||
          (!Object.hasOwn(slot, 'data') && !slot.unavailable)) {
        throw new Error('Sportision hat ein ungültiges Zeitfenster geliefert.');
      }
      return { start: slot.start, end: slot.start + slot.width,
        status: slot.data ? 'occupied' : slot.unavailable ? 'unreleased' : 'free' };
    });
    return { ...court, ...opening, slots };
  });

  let incomplete = false;
  const slots = hours.map(hour => {
    const start = hour * 60;
    const options = day.map(court => {
      let status;
      if (start < court.start || start + 60 > court.end) status = 'closed';
      else if (court.occupancy_hidden) status = 'error';
      else if (!coversHour(court.slots, start)) status = 'error';
      else if (court.slots.some(slot => slot.status === 'occupied' && overlaps(start, start + 60, slot))) status = 'occupied';
      else if (court.slots.some(slot => slot.status === 'unreleased' && overlaps(start, start + 60, slot))) status = 'unreleased';
      else status = 'free';
      return { name: court.name, status };
    });
    if (options.some(court => court.status === 'error')) incomplete = true;
    return hourStatus(options, ['error', 'unreleased', 'occupied']);
  });
  return { hours: slots, ...(incomplete && { incomplete }) };
}

export function sportisionHours(response) {
  return sportisionDay(response).hours;
}

export async function loadSportision(hall, dates, upstream) {
  return Promise.all(dates.map(async date => {
    const url = new URL(`https://backend.sportision.de/api/club/${hall.club}/space-manager/space/grid`);
    url.searchParams.set('date', date + 'T12:00:00.000Z');
    return { date, ...sportisionDay(await upstream(url, 'json')) };
  }));
}
