import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, mondayFor, berlinClock } from '../public/dates.mjs';
import { getHall, parseActiveCourt, tennis04Hours } from '../availability.mjs';

test('Kalenderwochen und Uhrzeiten folgen der Berliner Zeit', () => {
  assert.equal(berlinClock(new Date('2026-11-15T23:30:00Z')).date, '2026-11-16');
  assert.equal(mondayFor('2027-01-01'), '2026-12-28');
  assert.equal(addDays('2026-12-28', 7), '2027-01-04');
});

test('Hallen-URLs erlauben nur die unterstützten Anbieter', () => {
  assert.equal(getHall('https://app.tennis04.com/de/viernheim/buchungsplan').provider, 'tennis04');
  assert.throws(() => getHall('https://app.tennis04.com.evil.test/de/viernheim/buchungsplan'));
  assert.throws(() => getHall('https://app.tennis04.com@evil.test/de/viernheim/buchungsplan'));
});

test('ActiveCourt benötigt zwei durchgehend freie Halbzeiten auf demselben Platz', () => {
  const dates = Array.from({ length: 7 }, (_, i) => addDays('2026-11-16', i));
  const row = classes => '<tr>' + dates.map(() => '<td>' + classes.map((value, i) =>
    `<span title="${i + 1}" class="week-box ${value}">${i + 1}</span>`).join('') + '</td>').join('') + '</tr>';
  const times = ['17:00 - 17:30', '17:30 - 18:00', '18:00 - 18:30', '18:30 - 19:00', '19:00 - 19:30', '19:30 - 20:00'];
  const html = times.map(time => `<td class="week-period-time-title">${time}</td>`).join('') +
    '<div class="week-reservations-period-block"><table><tr>' +
    dates.map(date => `<th><span class="week_d_date">${date.split('-').reverse().join('.')}</span></th>`).join('') +
    '</tr>' + row(['available', 'ordered']) + row(['blocked', 'available']) +
    row(['available', 'unAvailable']) + row(['available', 'unAvailable']) +
    row(['unAvailable', 'unAvailable']) + row(['unAvailable', 'unAvailable']) + '</table></div>';
  const hours = parseActiveCourt(html, dates)[0].hours;
  assert.deepEqual(hours[17], { status: 'occupied', courts: [] });
  assert.deepEqual(hours[18], { status: 'free', courts: ['Platz 1'] });
  assert.deepEqual(hours[19], { status: 'unreleased', courts: [] });
  assert.throws(() => parseActiveCourt(html, dates.map(date => addDays(date, 7))));
});

test('Tennis04 erfasst überlappende Buchungen und bucht exakt angrenzende Stunden frei', () => {
  const date = '2026-11-16';
  const dates = [date, '2026-11-17'];
  const group = { courts: [{ id: 1, title: 'Pl.1' }, { id: 2, title: 'Pl.2' }],
    hourFrom: 8, minuteFrom: 0, hourUntil: 21, minuteUntil: 0, slotDurationMinutes: 60,
    seasons: [{ seasonBegin: date, seasonEnd: date, type: 'Winter' }], winterVisible: true };
  const bookings = [
    { start: date + 'T16:30:00', end: date + 'T17:30:00', resourceId: '1' },
    { start: date + 'T18:00:00', end: date + 'T19:00:00', resourceIds: ['2'] }
  ];
  const [monday, tuesday] = tennis04Hours(group, bookings, dates);
  assert.deepEqual(monday.hours[17], { status: 'free', courts: ['Platz 2'] });
  assert.deepEqual(monday.hours[18], { status: 'free', courts: ['Platz 1'] });
  assert.equal(monday.hours[21].status, 'free');
  assert.equal(monday.hours[22].status, 'closed');
  assert.equal(tuesday.hours[17].status, 'closed');
});
