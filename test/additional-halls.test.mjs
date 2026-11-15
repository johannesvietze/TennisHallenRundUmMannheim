import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultHalls, getHall, hallListVersion, restoreHalls } from '../public/halls.mjs';
import { parseEbusyGrid, ebusyHours, sportisionHours } from '../providers.mjs';

test('Neue Hallen ergänzen die zuvor gespeicherte Auswahl', () => {
  const migrated = restoreHalls([defaultHalls[0], { name: 'Eigene Halle', url: 'https://app.tennis04.com/de/eigene-halle/buchungsplan' }]);
  assert.equal(migrated.length, 9);
  assert.equal(migrated[1].name, 'Eigene Halle');
  assert.ok(!migrated.some(hall => hall.name === 'Schriesheim'));
  assert.equal(migrated.filter(hall => hall.name === 'Eppelheim').length, 1);
  assert.deepEqual(restoreHalls({ version: hallListVersion, halls: [] }), []);
});

test('Die neuen Links ergeben tennis04-, Sportision- und eBuSy-Quellen', () => {
  assert.deepEqual(defaultHalls.slice(2).map(hall => getHall(hall.url).provider).sort(),
    ['ebusy', 'ebusy', 'ebusy', 'ebusy', 'ebusy', 'sportision', 'tennis04']);
  assert.throws(() => getHall('https://verein.ebusy.de.example.org/court-module/2812'));
});

test('Hockenheim wird einer gespeicherten Auswahl einmal hinzugefügt und seine Startseite verweist auf die Halle', () => {
  const previous = defaultHalls.slice(0, -1);
  const migrated = restoreHalls({ halls: previous });
  const { url } = getHall('https://tc-hockenheim.ebusy.de/');
  assert.equal(url, 'https://tc-hockenheim.ebusy.de/court-module/451');
  assert.deepEqual(migrated.at(-1), { name: 'Hockenheim', url });
  assert.equal(restoreHalls({ halls: migrated }).length, migrated.length);
  assert.deepEqual(restoreHalls({ version: hallListVersion, halls: previous }), previous);
});

test('eBuSy berücksichtigt Halbzeiten, verbundene Plätze, Mitternacht und Squash', () => {
  const date = '2026-11-16';
  const providerDay = '11/16/2026';
  const header = (id, name) => `<div class="text-center court" data-id="${id}"><h3 class="court-header">${name}</h3></div>`;
  const cells = [1, 2, 3, 4].flatMap(court => [
    ['17:00', '17:30'], ['17:30', '18:00'], ['23:00', '00:00']
  ].map(([start, end]) => `<td class="slot" data-court="${court}" data-date="${providerDay}" data-minor-begin="${start}" data-minor-end="${end}"></td>`)).join('');
  const html = header(1, 'Platz 1') + header(2, 'Platz 2') + header(3, 'Squash') + header(4, 'Platz 4') + cells +
    `currentDate: "${providerDay}", dayBegin: "17:00", dayEnd: "00:00", singleBookingAvailable: "true"`;
  const reservations = {
    reservations: [
      { court: 1, date: providerDay, fromTime: '17:30', toTime: '18:00', blocksRelatedCourts: true },
      { court: 4, date: providerDay, fromTime: '22:00', toTime: '00:00' }
    ],
    courtRelations: [{ court: 1, relatedCourts: [2] }],
    suppressedReservationsCount: 0
  };
  const grid = parseEbusyGrid(html, date);
  const [day] = ebusyHours(grid, reservations, [date]);
  assert.deepEqual(day.hours[17], { status: 'free', courts: ['Platz 4'] });
  assert.deepEqual(day.hours[23], { status: 'free', courts: ['Platz 1', 'Platz 2'] });
  assert.throws(() => parseEbusyGrid(html, '2026-11-23'));
});

test('Sportision meldet nur eine volle freie Stunde und trennt verborgene Belegung', () => {
  const minutes = 17 * 60;
  const slots = [0, 15, 30, 45].map(offset => ({ start: minutes + offset, width: 15, data: null }));
  const court = { name: 'Halle 1', group_name: 'Hallenplätze', slots, opening_hours: { start: '17:00', end: '18:00' } };
  const booked = { ...court, name: 'Halle 2', slots: [{ start: minutes + 15, width: 30, data: {} }, slots[0], slots[3]] };
  const hidden = { ...court, name: 'Halle 3', occupancy_hidden: true };
  const unreleased = { ...court, slots: [...slots.slice(0, 3), { ...slots[3], unavailable: true }] };
  assert.deepEqual(sportisionHours({ data: [court, booked, hidden] })[17], { status: 'free', courts: ['Halle 1'] });
  assert.equal(sportisionHours({ data: [booked, hidden] })[17].status, 'error');
  assert.equal(sportisionHours({ data: [unreleased] })[17].status, 'unreleased');
  assert.equal(sportisionHours({ data: [booked] })[17].status, 'occupied');
  assert.equal(sportisionHours({ data: [court] })[18].status, 'closed');
});
