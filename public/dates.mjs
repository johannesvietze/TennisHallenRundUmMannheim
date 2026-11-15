const berlin = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23'
});

export function berlinClock(now = new Date()) {
  const parts = Object.fromEntries(berlin.formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function addDays(date, days) {
  const calendar = new Date(date + 'T00:00:00Z');
  calendar.setUTCDate(calendar.getUTCDate() + days);
  return calendar.toISOString().slice(0, 10);
}

export function mondayFor(date) {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function weekDates(monday) {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}
