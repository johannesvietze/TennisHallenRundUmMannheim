import { addDays, berlinClock, mondayFor, weekDates } from './dates.mjs';
import { bookingUrl, getHall, hallListVersion, maxHalls, restoreHalls } from './halls.mjs';

const $ = selector => document.querySelector(selector);
const hourSelect = $('#hour');
const hallSelect = $('#hall-filter');
const refreshButton = $('#refresh');
const details = $('#details');
const hallDialog = $('#halls-dialog');

const storageKey = 'hallenzeiten.halls';
const weekdayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const tones = ['fern', 'blue', 'rose', 'gold', 'purple', 'teal', 'brown', 'pink'];
const weekdayFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long', timeZone: 'UTC' });
const dateFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});
const clockFormat = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
});
const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const statuses = {
  occupied: 'Kein Platz frei',
  unreleased: 'Noch nicht freigegeben',
  closed: 'Außerhalb des Spielbetriebs',
  past: 'Zeit vergangen',
  error: 'Keine Daten verfügbar',
  external: 'Verfügbarkeit im Buchungsplan prüfen',
  loading: 'Wird geladen'
};

function loadHalls() {
  try {
    return restoreHalls(JSON.parse(localStorage.getItem(storageKey)));
  } catch {
    return restoreHalls(null);
  }
}

let halls = loadHalls();
const thisWeek = mondayFor(berlinClock().date);
const nextWeek = addDays(thisWeek, 7);
let monday = nextWeek;
let loading = false;
let results = new Map();
let requestId = 0;

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function dot(hall) {
  return element('span', `hall-dot ${tones[halls.indexOf(hall) % tones.length]}`);
}

function formatHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function hourRange(hour) {
  return `${formatHour(hour)}–${formatHour(hour + 1)}`;
}

function weekNumber(start) {
  const thursday = addDays(start, 3);
  const firstMonday = mondayFor(thursday.slice(0, 4) + '-01-04');
  return 1 + Math.round((Date.parse(start) - Date.parse(firstMonday)) / (7 * 86_400_000));
}

function weekTitle(start) {
  const end = addDays(start, 6);
  const day = date => String(Number(date.slice(8)));
  if (start.slice(0, 7) === end.slice(0, 7)) return `${day(start)}.–${dateFormat.format(new Date(end))}`;
  if (start.slice(0, 4) === end.slice(0, 4)) {
    const first = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `${first.format(new Date(start))} – ${dateFormat.format(new Date(end))}`;
  }
  return `${dateFormat.format(new Date(start))} – ${dateFormat.format(new Date(end))}`;
}

function displayHours() {
  const openHours = new Set();
  for (const result of results.values()) {
    for (const day of result.days ?? []) {
      day.hours.forEach((slot, hour) => {
        if (slot.status !== 'closed') openHours.add(hour);
      });
    }
  }
  return openHours.size ? [...openHours].sort((a, b) => a - b) :
    Array.from({ length: 17 }, (_, index) => 7 + index);
}

function enabledHalls() {
  return halls.filter(hall => !hall.disabled);
}

function slotFor(hall, date, hour, now) {
  if (date < now.date || (date === now.date && hour <= now.hour)) return { status: 'past', courts: [] };
  if (loading && !results.size) return { status: 'loading', courts: [] };
  const result = results.get(hall.url);
  if (result?.bookingOnly) return { status: 'external', courts: [] };
  return result?.days?.find(day => day.date === date)?.hours[hour] ?? { status: 'error', courts: [] };
}

function slotCell(date, hour, visibleHalls, now) {
  const cell = element('td', 'slot-cell');
  const entries = visibleHalls.map(hall => ({ hall, ...slotFor(hall, date, hour, now) }));
  const free = entries.filter(entry => entry.status === 'free');
  const count = free.reduce((total, entry) => total + entry.courts.length, 0);
  const status = count ? 'free' :
    ['loading', 'error', 'unreleased', 'occupied', 'external', 'past', 'closed'].find(key => entries.some(entry => entry.status === key));

  const day = weekdayFormat.format(new Date(date));
  const label = count ? `${count} ${count === 1 ? 'freier Platz' : 'freie Plätze'}` : statuses[status];
  const prices = free.flatMap(entry => entry.courtPrices ?? []).filter(Number.isSafeInteger);
  const priceLabel = prices.length ? `ab ${euroFormat.format(Math.min(...prices) / 100)}` : '';
  const button = element('button', `slot ${status}`);
  button.type = 'button';
  button.setAttribute('aria-label', [
    `${day}, ${hourRange(hour)} Uhr`,
    count ? `${label} in ${free.map(entry => entry.hall.name).join(', ')}` : label,
    priceLabel ? `${priceLabel} pro Stunde` : ''
  ].filter(Boolean).join(', '));
  button.title = button.getAttribute('aria-label');

  if (count) {
    button.append(element('span', 'slot-count', `${count} frei`));
    if (priceLabel) button.append(element('span', 'slot-price', priceLabel));
    for (const [index, entry] of free.slice(0, 2).entries()) {
      const name = element('span', 'slot-halls');
      name.append(dot(entry.hall), element('span', 'slot-name', entry.hall.name));
      if (index === 1 && free.length > 2) name.append(element('span', 'slot-extra', `+${free.length - 2}`));
      button.append(name);
    }
  } else {
    const marker = { occupied: '–', past: '·', closed: '·', unreleased: 'Ausstehend', error: 'Keine Daten',
      external: 'Buchungsplan ↗', loading: '…' }[status];
    button.append(element('span', 'slot-marker', marker));
  }
  if (['past', 'loading', 'closed'].includes(status)) button.disabled = true;
  else button.addEventListener('click', () => showDetails(date, hour, entries));
  cell.append(button);
  return cell;
}

function renderGrid() {
  const dates = weekDates(monday);
  const now = berlinClock();
  const visibleHalls = enabledHalls().filter(hall => !hallSelect.value || hallSelect.value === hall.url);
  const header = element('tr');
  const time = element('th', 'time-column', 'Uhrzeit');
  time.scope = 'col';
  header.append(time);

  dates.forEach((date, index) => {
    const th = element('th', `day-column${date === now.date ? ' today' : ''}${index >= 5 ? ' weekend' : ''}`);
    th.scope = 'col';
    th.setAttribute('aria-label', dateFormat.format(new Date(date)));
    th.append(element('span', 'day-name', weekdayNames[index]), element('span', 'day-date', date.slice(5).split('-').reverse().join('.') + '.'));
    header.append(th);
  });
  $('#grid thead').replaceChildren(header);

  const body = document.createDocumentFragment();
  if (!visibleHalls.length) {
    const message = halls.length ? 'Aktiviere unter „Meine Hallen“ eine Halle.' :
      'Füge unter „Meine Hallen“ einen Buchungsplan hinzu.';
    const cell = element('td', 'empty', message);
    cell.colSpan = 8;
    const row = element('tr');
    row.append(cell);
    body.append(row);
  } else {
    const hours = hourSelect.value === '' ? displayHours() : [Number(hourSelect.value)];
    for (const hour of hours) {
      const row = element('tr');
      const timeCell = element('th', 'time-column row-time');
      timeCell.scope = 'row';
      timeCell.append(element('span', 'start-time', formatHour(hour)), element('span', 'end-time', 'bis ' + formatHour(hour + 1)));
      row.append(timeCell, ...dates.map(date => slotCell(date, hour, visibleHalls, now)));
      body.append(row);
    }
  }
  $('#grid tbody').replaceChildren(body);
}

function renderHallFilter() {
  const selected = hallSelect.value;
  const enabled = enabledHalls();
  hallSelect.replaceChildren(new Option('Alle Hallen', ''), ...enabled.map(hall => new Option(hall.name, hall.url)));
  if (enabled.some(hall => hall.url === selected)) hallSelect.value = selected;
}

function render() {
  const enabled = enabledHalls();
  $('#week-number').textContent = `Kalenderwoche ${weekNumber(monday)}`;
  $('#week-title').textContent = weekTitle(monday);
  $('#previous').disabled = monday <= addDays(thisWeek, -7);
  $('#next').disabled = monday >= addDays(thisWeek, 7 * 52);
  $('#this-week').setAttribute('aria-pressed', monday === thisWeek);
  $('#next-week').setAttribute('aria-pressed', monday === nextWeek);
  $('#hall-count').textContent = enabled.length;
  refreshButton.disabled = loading || !enabled.length;
  refreshButton.classList.toggle('refreshing', loading);
  $('#calendar-scroll').setAttribute('aria-busy', String(loading));

  const checkedTimes = [...results.values()].map(result => result.checkedAt).filter(Boolean).sort();
  $('#updated').textContent = loading ? 'Lade Buchungspläne …' :
    checkedTimes.length ? `Stand ${clockFormat.format(new Date(checkedTimes[0]))} Uhr` : '';
  renderAvailabilityWarning(enabled);
  const messages = enabled.flatMap(hall => {
    const result = results.get(hall.url);
    if (!result?.bookingOnly) return [];
    const message = element('div', null, `${hall.name}: `);
    message.append(bookingLink(hall, undefined, 'Verfügbarkeit und Preise bei Eversports ↗'));
    return [message];
  });
  const notice = $('#notice');
  notice.hidden = !messages.length;
  notice.replaceChildren(...messages);

  const legend = $('#legend');
  const free = element('span', 'legend-item');
  free.append(element('span', 'legend-free'), element('span', null, 'Freie Plätze'));
  const occupied = element('span', 'legend-item');
  occupied.append(element('span', 'legend-occupied'), element('span', null, 'Kein Platz frei'));
  const unreleased = element('span', 'legend-item');
  unreleased.append(element('span', 'legend-unreleased'), element('span', null, 'Noch nicht freigegeben'));
  legend.replaceChildren(free, occupied, unreleased);
  renderGrid();
}

function renderAvailabilityWarning(enabled) {
  const warning = $('#availability-warning');
  const issues = enabled.flatMap(hall => {
    const result = results.get(hall.url);
    const message = result?.error ?? (result?.days?.some(day => day.incomplete)
      ? 'Für manche Zeiten fehlen Verfügbarkeitsdaten.'
      : null);
    if (!message) return [];

    const item = element('li');
    const link = bookingLink(hall, monday);
    link.setAttribute('aria-label', `Zum Buchungsplan von ${hall.name}`);
    item.append(element('strong', null, hall.name), document.createTextNode(` · ${message} `), link);
    return [item];
  });
  if (issues.length) {
    const list = element('ul');
    list.append(...issues);
    warning.replaceChildren(element('h3', null, 'Verfügbarkeit nicht vollständig'), list);
  } else {
    warning.replaceChildren();
  }
}

async function refresh(refreshNow = false) {
  const id = ++requestId;
  const enabled = enabledHalls();
  if (!refreshNow) results = new Map();
  loading = Boolean(enabled.length);
  render();
  if (!loading) return;

  try {
    const response = await fetch('/api/availability', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ monday, urls: enabled.map(hall => hall.url), refresh: refreshNow })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (id !== requestId) return;
    results = new Map(data.halls.map(hall => [hall.url, hall]));
  } catch {
    if (id !== requestId) return;
    results = new Map(enabled.map(hall => [hall.url, { error: 'Der Buchungsplan konnte nicht geladen werden.' }]));
  } finally {
    if (id === requestId) {
      loading = false;
      render();
    }
  }
}

function bookingLink(hall, date, label = 'Zum Buchungsplan ↗') {
  const link = element('a', 'source-link', label);
  link.href = bookingUrl(getHall(hall.url), date);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function showDetails(date, hour, entries) {
  $('#details-title').textContent = `${weekdayFormat.format(new Date(date))}, ${dateFormat.format(new Date(date))} · ${hourRange(hour)}`;
  const items = entries.map(({ hall, status, courts, courtPrices }) => {
    const card = element('article', 'detail-item');
    const title = element('h3');
    title.append(dot(hall), document.createTextNode(hall.name));
    card.append(title);
    if (status === 'free') {
      const list = element('ul', 'detail-courts');
      for (const [index, court] of courts.entries()) {
        const price = courtPrices?.[index];
        const item = element('li');
        item.append(element('span', 'detail-free', court), element('span', 'muted',
          Number.isSafeInteger(price) ? `${euroFormat.format(price / 100)}/Std.` : 'Preis nicht verfügbar'));
        list.append(item);
      }
      card.append(list);
    } else {
      card.append(element('p', 'muted', statuses[status]));
    }
    card.append(bookingLink(hall, date));
    return card;
  });
  $('#details-content').replaceChildren(...items);
  details.showModal();
}

function saveHalls(next, focusUrl) {
  if (next.filter(hall => !hall.disabled).length > maxHalls) {
    showHallError(`Es können bis zu ${maxHalls} Hallen gleichzeitig aktiv sein.`);
    return;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: hallListVersion, halls: next }));
  } catch {
    showHallError('Die Hallenliste kann in diesem Browser nicht gespeichert werden.');
    return;
  }
  showHallError('');
  halls = next;
  renderHallList(focusUrl);
  renderHallFilter();
  refresh();
}

function renderHallList(focusUrl) {
  const items = halls.map(hall => {
    const row = element('div', 'hall-item');
    const info = element('div');
    const title = element('strong');
    title.append(dot(hall), document.createTextNode(hall.name));
    const host = element('a', 'muted', new URL(hall.url).hostname.replace(/^www\./, ''));
    const source = getHall(hall.url);
    host.href = source.provider === 'eversports' ? bookingUrl(source) : hall.url;
    host.target = '_blank';
    host.rel = 'noopener noreferrer';
    info.append(title, host);
    const action = hall.disabled ? 'Aktivieren' : 'Deaktivieren';
    const toggle = element('button', 'button small', action);
    toggle.type = 'button';
    toggle.setAttribute('aria-label', `${action}: ${hall.name}`);
    toggle.addEventListener('click', () => {
      saveHalls(halls.map(entry => entry === hall ? { ...entry, disabled: !hall.disabled } : entry), hall.url);
    });
    row.append(info, toggle);
    return row;
  });
  $('#hall-list').replaceChildren(...items);
  const focusIndex = halls.findIndex(hall => hall.url === focusUrl);
  items[focusIndex]?.querySelector('button').focus();
}

function showHallError(message) {
  const error = $('#hall-error');
  error.hidden = !message;
  error.textContent = message;
}

function navigate(week) {
  if (week === monday) return;
  monday = week;
  refresh();
}

for (let hour = 0; hour < 24; hour++) hourSelect.add(new Option(hourRange(hour) + ' Uhr', hour));
hourSelect.addEventListener('change', renderGrid);
hallSelect.addEventListener('change', renderGrid);
$('#previous').addEventListener('click', () => navigate(addDays(monday, -7)));
$('#next').addEventListener('click', () => navigate(addDays(monday, 7)));
$('#this-week').addEventListener('click', () => navigate(thisWeek));
$('#next-week').addEventListener('click', () => navigate(nextWeek));
refreshButton.addEventListener('click', () => refresh(true));
$('#manage').addEventListener('click', () => {
  renderHallList();
  showHallError('');
  hallDialog.showModal();
});

renderHallFilter();
refresh();
