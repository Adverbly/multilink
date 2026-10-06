import { parsePublicKey, randomToken, sha256, toBase64Url } from '../crypto.js';
import { sendRecoveryEmail } from '../email.js';
import { HttpError, json, readJson } from '../http.js';
import {
  MAX_KEYS,
  cleanText,
  getActiveKeys,
  getSite,
  requireSubdomain,
  upsertKey,
} from '../sites.js';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const TOKEN_MS = 30 * 60_000;

// "Forgot key". The response is the same whether or not the subdomain has an
// owner, and the email is sent in the background so timing doesn't tell either.
export async function requestRecovery(request, env, url, ctx) {
  const name = requireSubdomain(url, env);
  const now = Date.now();
  const recent = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(site = ?1 AND created_at > ?2), 0) AS hour,
       COALESCE(SUM(site = ?1), 0) AS day,
       COUNT(*) AS everyone
     FROM recovery_requests WHERE created_at > ?3`
  )
    .bind(name, now - HOUR, now - DAY)
    .first();
  const dailyLimit = Number(env.RECOVERY_DAILY_LIMIT || 50);
  if (recent.hour >= 1 || recent.day >= 3 || recent.everyone >= dailyLimit) {
    throw new HttpError(
      429,
      'A recovery email was requested recently. Check your inbox, or try again later.'
    );
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM recovery_requests WHERE created_at <= ?').bind(
      now - DAY
    ),
    env.DB.prepare(
      'INSERT INTO recovery_requests (site, created_at) VALUES (?, ?)'
    ).bind(name, now),
  ]);
  ctx.waitUntil(sendRecovery(env, url, name, now).catch(console.error));
  return json({ ok: true });
}

async function sendRecovery(env, url, name, now) {
  const site = await getSite(env.DB, name);
  if (!site?.email) return;
  const token = randomToken();
  await env.DB.prepare(
    'INSERT INTO recovery_tokens (token_hash, site, expires_at) VALUES (?, ?, ?)'
  )
    .bind(await hashToken(token), name, now + TOKEN_MS)
    .run();
  // The token goes in the #fragment so it never reaches server logs.
  await sendRecoveryEmail(env, {
    to: site.email,
    host: url.host,
    link: `${url.origin}/recover#t=${token}`,
  });
}

export async function recoveryKeys(request, env, url) {
  const name = requireSubdomain(url, env);
  const { token } = await readJson(request);
  await checkToken(env.DB, name, token);
  const keys = await getActiveKeys(env.DB, name);
  return json({
    keys: keys.map((k) => ({
      id: k.id,
      label: k.label,
      createdAt: k.created_at,
    })),
  });
}

// Adds a key and/or revokes keys, then uses up the token.
export async function applyRecovery(request, env, url) {
  const name = requireSubdomain(url, env);
  const { token, addKey, revoke = [] } = await readJson(request);
  const tokenHash = await checkToken(env.DB, name, token);
  if (!Array.isArray(revoke) || revoke.some((id) => typeof id !== 'string')) {
    throw new HttpError(400, 'Invalid request');
  }
  const added = addKey && (await parsePublicKey(addKey.publicKey));
  if (addKey && !added) throw new HttpError(400, 'Invalid public key');

  const active = await getActiveKeys(env.DB, name);
  const kept = active.filter(
    (k) => !revoke.includes(k.id) && k.id !== added?.id
  );
  const total = kept.length + (added ? 1 : 0);
  if (total < 1) throw new HttpError(400, 'Keep or add at least one key.');
  if (total > MAX_KEYS) {
    throw new HttpError(400, `You can have up to ${MAX_KEYS} keys.`);
  }

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE recovery_tokens SET used_at = ? WHERE token_hash = ?'
    ).bind(now, tokenHash),
    ...revoke.map((id) =>
      env.DB.prepare(
        'UPDATE owner_keys SET revoked_at = ? WHERE site = ? AND id = ? AND revoked_at IS NULL'
      ).bind(now, name, id)
    ),
    ...(added
      ? [
          upsertKey(
            env.DB,
            name,
            {
              id: added.id,
              publicKey: addKey.publicKey,
              label: cleanText(addKey.label, 60),
            },
            now
          ),
        ]
      : []),
  ]);
  return json({ ok: true });
}

async function hashToken(token) {
  return toBase64Url(await sha256(token));
}

async function checkToken(db, name, token) {
  const tokenHash = typeof token === 'string' && (await hashToken(token));
  const row =
    tokenHash &&
    (await db
      .prepare('SELECT * FROM recovery_tokens WHERE token_hash = ?')
      .bind(tokenHash)
      .first());
  if (!row || row.site !== name || row.used_at || row.expires_at < Date.now()) {
    throw new HttpError(
      401,
      'This recovery link has expired or was already used.'
    );
  }
  return tokenHash;
}
