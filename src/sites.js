import { HttpError } from './http.js';

export const MAX_KEYS = 10;

// A single DNS label. Punycode (xn--) is refused so names can't imitate others.
const NAME = /^(?!xn--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// The subdomain a request is for, or null on the main site. Hosts outside
// ROOT_DOMAIN (like a workers.dev preview) count as the main site.
export function subdomainOf(url, env) {
  const host = url.hostname.toLowerCase();
  const root = env.ROOT_DOMAIN.toLowerCase();
  if (!host.endsWith('.' + root)) return null;
  const name = host.slice(0, -root.length - 1);
  return name === 'www' ? null : name;
}

export function nameProblem(name) {
  if (!NAME.test(name)) return 'invalid';
  if (name === 'www') return 'reserved';
  return null;
}

export function requireSubdomain(url, env) {
  const name = subdomainOf(url, env);
  if (name === null || nameProblem(name)) throw new HttpError(404, 'Not found');
  return name;
}

function originFor(url, host) {
  return `${url.protocol}//${host}${url.port ? ':' + url.port : ''}`;
}

export function rootOrigin(url, env) {
  return originFor(url, env.ROOT_DOMAIN);
}

export function siteOrigin(url, env, name) {
  return originFor(url, `${name}.${env.ROOT_DOMAIN}`);
}

export function getSite(db, name) {
  return db.prepare('SELECT * FROM sites WHERE name = ?').bind(name).first();
}

export async function getActiveKeys(db, name) {
  const { results } = await db
    .prepare(
      'SELECT id, public_key, label, created_at FROM owner_keys WHERE site = ? AND revoked_at IS NULL ORDER BY created_at',
    )
    .bind(name)
    .all();
  return results;
}

// 'taken', 'pending' (someone is checking out) or 'available'.
export async function availability(db, name, now = Date.now()) {
  if (await getSite(db, name)) return 'taken';
  const pending = await db
    .prepare(
      "SELECT 1 FROM claims WHERE site = ? AND status = 'pending' AND expires_at > ?",
    )
    .bind(name, now)
    .first();
  return pending ? 'pending' : 'available';
}

// Re-adding a revoked key brings it (and the links it signed) back.
export function upsertKey(db, site, { id, publicKey, label }, now) {
  return db
    .prepare(
      `INSERT INTO owner_keys (site, id, public_key, label, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (site, id) DO UPDATE SET revoked_at = NULL, label = excluded.label, created_at = excluded.created_at`,
    )
    .bind(site, id, publicKey, label, now);
}

export function cleanText(value, max) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, max)
    : '';
}
