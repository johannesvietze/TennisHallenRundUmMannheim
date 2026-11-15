const accountTag = process.env.CLOUDFLARE_ACCOUNT_ID;
const siteTag = process.env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const query = `
  query SiteVisits($accountTag: string!, $siteTag: string!, $since: Time!, $until: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        rumPageloadEventsAdaptiveGroups(
          filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until }
          limit: 1
        ) {
          sum { visits }
        }
      }
    }
  }
`;

let visits = null;
let expires = 0;
let pending;

async function fetchVisits() {
  const now = Date.now();
  const since = new Date(now - 7 * 86_400_000).toISOString();
  const until = new Date(now).toISOString();
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { accountTag, siteTag, since, until } }),
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw new Error(`Cloudflare HTTP ${response.status}`);

  const { data, errors } = await response.json();
  const groups = data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups;
  if (errors?.length || !Array.isArray(groups)) throw new Error('Ungültige Cloudflare-Antwort');
  if (!groups.length) return 0;

  const total = groups[0]?.sum?.visits;
  if (!Number.isFinite(total) || total < 0) throw new Error('Ungültige Cloudflare-Besuchszahl');
  return Math.round(total);
}

export async function getVisits() {
  if (!accountTag || !siteTag || !apiToken) return null;
  if (Date.now() < expires) return visits;
  if (!pending) {
    pending = fetchVisits().then(total => {
      visits = total;
      expires = Date.now() + 5 * 60_000;
      return visits;
    }, () => {
      console.warn('Cloudflare-Besuchszahl konnte nicht abgerufen werden.');
      visits = null;
      expires = Date.now() + 60_000;
      return visits;
    }).finally(() => { pending = undefined; });
  }
  return pending;
}
