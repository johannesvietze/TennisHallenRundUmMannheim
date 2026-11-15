import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAvailability, tennis04Hours } from '../availability.mjs';
import { loadEbusy } from '../providers.mjs';
import { weekDates } from '../public/dates.mjs';

const date = '2026-11-16';
const providerDate = '11/16/2026';

test('tennis04 uses the guest hourly tariff for the selected season and weekday', () => {
  const group = {
    courts: [{ id: 1, title: 'Pl.1' }], hourFrom: 8, minuteFrom: 0, hourUntil: 23, minuteUntil: 0,
    seasons: [{ id: 5, seasonBegin: date, type: 'Winter' }], winterVisible: true
  };
  const mondayEvening = {
    weekDay: 1, beginTime: '1900-01-01T17:00:00', endTime: '1900-01-02T00:00:00', price: 24.5
  };
  const legend = { priceUnit: 60, tariffTable: [
    { group: 'Club', prices: [{ ...mondayEvening, price: 18 }] },
    { group: 'Gast', prices: [mondayEvening] }
  ] };
  const [monday, tuesday] = tennis04Hours(group, [], [date, '2026-11-17'], new Map([[5, legend]]));
  assert.deepEqual(monday.hours[23], { status: 'free', courts: ['Platz 1'], courtPrices: [2450] });
  assert.deepEqual(monday.hours[16], { status: 'free', courts: ['Platz 1'] });
  assert.deepEqual(tuesday.hours[17], { status: 'free', courts: ['Platz 1'] });
});

test('eBuSy associates public single-booking prices with the correct free court', async () => {
  const hall = { provider: 'ebusy', url: 'https://verein.ebusy.de/hallenplaetze' };
  const html = [1, 2, 3].map(court =>
    `<div class="court" data-id="${court}"><h3 class="court-header">Platz ${court}</h3></div>` +
    `<td class="slot" data-court="${court}" data-date="${providerDate}" data-minor-begin="17:00" data-minor-end="18:00"></td>`
  ).join('') + `currentDate: "${providerDate}", dayBegin: "17:00", dayEnd: "18:00", singleBookingAvailable: "true"` +
    '<a href="/hallenplaetze?prices-for=41&amp;selectedDate=11/16/2026">Einzelbuchung</a>' +
    '<a href="/hallenplaetze?prices-for=42&amp;selectedDate=11/16/2026">Einzelbuchung Mitarbeiter</a>';
  const zone = { weekday: 'MONDAY', fromTime: '17:00', toTime: '18:00', priceLong: '18,50 €', price: 18.5 };
  const zones = [
    { ...zone, court: 1, toTime: '17:30' }, { ...zone, court: 1, fromTime: '17:30' },
    { ...zone, court: 2, toTime: '17:30' }, { ...zone, court: 3 }
  ];
  const reservations = {
    reservations: [{ court: 3, date: providerDate, fromTime: '17:00', toTime: '18:00' }],
    courtRelations: [], suppressedReservationsCount: 0
  };
  const upstream = async (url, format) => {
    if (format === 'json') return reservations;
    if (!url.searchParams.has('prices-for')) return html;
    assert.equal(url.searchParams.get('prices-for'), '41');
    assert.equal(url.searchParams.get('view'), 'WEEK');
    return html + `pricesFor: "41", priceZones: ${JSON.stringify(JSON.stringify(zones))}`;
  };
  const [day] = await loadEbusy(hall, [date], upstream);
  assert.deepEqual(day.hours[17], { status: 'free', courts: ['Platz 1', 'Platz 2'], courtPrices: [1850, null] });

  const [withoutPrices] = await loadEbusy(hall, [date], (url, format) => {
    if (url.searchParams.has('prices-for')) throw new Error('Preisansicht nicht erreichbar');
    return upstream(url, format);
  });
  assert.deepEqual(withoutPrices.hours[17], { status: 'free', courts: ['Platz 1', 'Platz 2'] });
});

test('Schriesheim applies published winter rates only during the listed hours', async t => {
  const hall = { provider: 'activecourt', url: 'https://www.tennishalle-schriesheim.de/reservations.php' };
  const dates = weekDates(date);
  const grid = '<td class="week-period-time-title">17:00 - 17:30</td>' +
    '<td class="week-period-time-title">17:30 - 18:00</td>' +
    '<td class="week-period-time-title">18:00 - 18:30</td>' +
    '<td class="week-period-time-title">18:30 - 19:00</td>' +
    '<div class="week-reservations-period-block"><table><tr>' +
    dates.map(day => `<th><span class="week_d_date">${day.split('-').reverse().join('.')}</span></th>`).join('') +
    '</tr>' + ('<tr>' + '<td><span class="week-box available">1</span></td>'.repeat(7) + '</tr>').repeat(4) +
    '</table></div>';
  const prices = '<p>Preisliste Tennishalle Schriesheim&nbsp; Wintersaison&nbsp; 1.Oktober bis 30. April</p>' +
    '<p>Montag bis Freitag:</p><p>17.00 - 18.00 Uhr&nbsp; 24.00 &euro;uro</p>' +
    '<p>Samstag und Sonntag</p><p>17.00 - 19.00 Uhr&nbsp; 21,50 &euro;uro</p>';
  t.mock.method(globalThis, 'fetch', async url => new Response(url.pathname === '/price.php' ? prices : grid));

  const { days } = await loadAvailability(hall, dates);
  assert.deepEqual(days[0].hours[17], { status: 'free', courts: ['Platz 1'], courtPrices: [2400] });
  assert.deepEqual(days[0].hours[18], { status: 'free', courts: ['Platz 1'] });
  assert.deepEqual(days[5].hours[17], { status: 'free', courts: ['Platz 1'], courtPrices: [2150] });
});
