import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { addDays, berlinClock, mondayFor, weekDates } from './public/dates.mjs';
import { getHall, maxHalls } from './public/halls.mjs';
import { loadAvailability } from './availability.mjs';

const port = Number(process.env.PORT || 3000);
const onRender = process.env.RENDER === 'true';
const bindHost = onRender ? '0.0.0.0' : '127.0.0.1';
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/dates.mjs', ['dates.mjs', 'text/javascript; charset=utf-8']],
  ['/halls.mjs', ['halls.mjs', 'text/javascript; charset=utf-8']]
]);
const cache = new Map();
const inFlight = new Map();
const cacheDuration = 2 * 60_000;

async function cachedAvailability(hall, monday, refresh) {
  const key = `${hall.url}:${monday}`;
  const now = Date.now();
  for (const [item, entry] of cache) {
    if (now - entry.time >= cacheDuration) cache.delete(item);
  }
  if (!refresh && cache.has(key)) return cache.get(key).data;
  if (inFlight.has(key)) return inFlight.get(key);

  const request = loadAvailability(hall, weekDates(monday)).then(data => {
    if (cache.size >= 120) cache.delete(cache.keys().next().value);
    cache.set(key, { data, time: Date.now() });
    return data;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

function validWeek(monday) {
  if (typeof monday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(monday)) return false;
  const date = new Date(monday + 'T00:00:00Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== monday || mondayFor(monday) !== monday) {
    return false;
  }
  const current = mondayFor(berlinClock().date);
  return monday >= addDays(current, -7) && monday <= addDays(current, 7 * 52);
}

async function readJson(request) {
  let contents = '';
  for await (const chunk of request) {
    contents += chunk;
    if (contents.length > 8192) throw new Error('Die Anfrage ist zu groß.');
  }
  return JSON.parse(contents);
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  response.setHeader('x-content-type-options', 'nosniff');
  if (!onRender && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host ?? '')) {
    return json(response, 403, { error: 'Die App ist nur lokal erreichbar.' });
  }
  const path = request.url?.split('?')[0];
  if (request.method === 'POST' && path === '/api/availability') {
    if (request.headers['sec-fetch-site'] === 'cross-site' ||
        request.headers['content-type']?.split(';')[0] !== 'application/json') {
      return json(response, 403, { error: 'Die Anfrage muss aus der App stammen.' });
    }

    let monday, halls, refresh;
    try {
      const body = await readJson(request);
      monday = body.monday;
      refresh = body.refresh === true;
      if (!validWeek(monday)) throw new Error('Wähle eine gültige Kalenderwoche.');
      if (!Array.isArray(body.urls) || body.urls.length > maxHalls) throw new Error('Ungültige Hallenliste.');
      halls = Array.from(new Set(body.urls.map(url => getHall(url).url))).map(getHall);
    } catch (error) {
      return json(response, 400, { error: error instanceof SyntaxError ? 'Ungültige Anfrage.' : error.message });
    }

    const results = await Promise.all(halls.map(async hall => {
      try {
        return { url: hall.url, ...await cachedAvailability(hall, monday, refresh) };
      } catch (error) {
        return { url: hall.url, error: error.message };
      }
    }));
    return json(response, 200, { monday, halls: results });
  }

  const asset = assets.get(path);
  if (request.method !== 'GET' || !asset) return json(response, 404, { error: 'Seite nicht gefunden.' });
  try {
    const body = await readFile(new URL('./public/' + asset[0], import.meta.url));
    response.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-cache' });
    response.end(body);
  } catch {
    json(response, 500, { error: 'Die Datei konnte nicht geladen werden.' });
  }
});

server.listen(port, bindHost, () => {
  console.log(`Hallenzeiten läuft unter http://${bindHost}:${server.address().port}`);
});
