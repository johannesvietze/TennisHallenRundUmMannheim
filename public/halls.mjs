const originalHalls = [
  { name: 'Viernheim', url: 'https://app.tennis04.com/de/viernheim/buchungsplan' },
  { name: 'Schriesheim', url: 'https://www.tennishalle-schriesheim.de/reservations.php?action=showReservations&type_id=1&sport_id=1&area_id=1&page=1&week=0' }
];

const additionalHalls = [
  { name: 'Friedrichsfeld', url: 'https://tennis-sv0829friedrichsfeld.ebusy.de/court-module/2812' },
  { name: 'Rheinau', url: 'https://tgrheinau.ebusy.de/court-module/1572' },
  { name: 'Plankstadt', url: 'https://tcplankstadt.ebusy.de/hallenplaetze' },
  { name: 'Pawlik · Ladenburg', url: 'https://www.sportision.de/club/tennisschule-pawlik-1?tab=spaces' },
  { name: 'Eppelheim', url: 'https://app.tennis04.com/de/eppelheim/buchungsplan' },
  { name: 'Sportcenter Tröndle', url: 'https://troendle-sportcenter.ebusy.de/court-module/162' }
];

const hockenheim = { name: 'Hockenheim', url: 'https://tc-hockenheim.ebusy.de/court-module/451' };
const previousDefaults = [...originalHalls, ...additionalHalls, hockenheim];
const newHalls = [
  { name: 'Walldorf', url: 'https://app.tennis04.com/de/walldorf/buchungsplan' },
  { name: 'ZAP Nußloch', url: 'https://www.eversports.de/widget/w/mz2a2z' }
];

export const defaultHalls = [...previousDefaults, ...newHalls];
export const maxHalls = 16;
export const hallListVersion = 4;

export function restoreHalls(saved) {
  const version = saved?.version ?? 1;
  let entries = saved?.halls ?? defaultHalls;
  if (Array.isArray(saved)) {
    entries = [...saved, ...additionalHalls, hockenheim];
  } else if (saved?.halls && version < 2) {
    entries = [...saved.halls, hockenheim];
  }
  const halls = new Map();
  for (const hall of entries) {
    const { url } = getHall(hall.url);
    if (halls.has(url)) continue;
    const entry = { name: String(hall.name).slice(0, 36), url };
    if (hall.disabled === true) entry.disabled = true;
    halls.set(url, entry);
    if (version < 3 && halls.size === maxHalls) break;
  }
  if (version < 3) {
    for (const hall of previousDefaults) {
      if (!halls.has(hall.url)) halls.set(hall.url, { ...hall, disabled: true });
    }
  }
  if (version < 4) {
    let active = [...halls.values()].filter(hall => !hall.disabled).length;
    for (const hall of newHalls) {
      if (halls.has(hall.url)) continue;
      const disabled = active >= maxHalls;
      halls.set(hall.url, disabled ? { ...hall, disabled } : { ...hall });
      if (!disabled) active++;
    }
  }
  return [...halls.values()];
}

export function getHall(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Bitte gib eine vollständige HTTPS-Adresse zum Buchungsplan ein.');
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) {
    throw new Error('Bitte gib eine HTTPS-Adresse zum Buchungsplan ein.');
  }

  const tennis04 = url.hostname === 'app.tennis04.com' &&
    url.pathname.match(/^\/(?:[a-z]{2}\/)?([a-z\d_-]+)(?:\/buchungsplan)?\/?$/i);
  if (tennis04) {
    const club = tennis04[1].toLowerCase();
    return { provider: 'tennis04', url: `https://app.tennis04.com/de/${club}/buchungsplan` };
  }

  if (['www.tennishalle-schriesheim.de', 'tennishalle-schriesheim.de'].includes(url.hostname) &&
      url.pathname === '/reservations.php') {
    return { provider: 'activecourt', url: originalHalls[1].url };
  }

  if (url.hostname === 'tc-hockenheim.ebusy.de' && url.pathname === '/') {
    return { provider: 'ebusy', url: hockenheim.url };
  }

  if (/^[a-z0-9-]+\.ebusy\.de$/.test(url.hostname) &&
      /^\/(?:court-module\/\d+|[a-z\d-]{1,80})\/?$/.test(url.pathname)) {
    return { provider: 'ebusy', url: url.origin + url.pathname.replace(/\/$/, '') };
  }

  const sportision = ['www.sportision.de', 'sportision.de'].includes(url.hostname) &&
    url.pathname.match(/^\/club\/([a-z\d-]{1,80})\/?$/);
  if (sportision) {
    return { provider: 'sportision', club: sportision[1], url: `https://www.sportision.de/club/${sportision[1]}?tab=spaces` };
  }

  const eversports = ['www.eversports.de', 'eversports.de'].includes(url.hostname) &&
    url.pathname.match(/^\/widget\/w\/([a-z\d]{1,32})\/?$/i);
  if (eversports) {
    return { provider: 'eversports', url: `https://www.eversports.de/widget/w/${eversports[1]}` };
  }

  throw new Error('Unterstützt werden tennis04, eBuSy, Sportision, Eversports-Widgets und die Tennishalle Schriesheim.');
}

export function ebusyDate(date) {
  const [year, month, day] = date.split('-');
  return `${month}/${day}/${year}`;
}

export function bookingUrl(hall, date) {
  const url = new URL(hall.url);
  if (hall.provider === 'activecourt') url.searchParams.set('date', date);
  if (hall.provider === 'ebusy') url.searchParams.set('selectedDate', ebusyDate(date));
  if (hall.provider === 'eversports') url.searchParams.set('sport', 'tennis');
  return url.href;
}
