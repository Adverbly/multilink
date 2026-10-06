import { parsePublicKey, verifySignature } from '../crypto.js';
import { HttpError, json, parseJson, readText } from '../http.js';
import {
  MAX_KEYS,
  cleanText,
  getActiveKeys,
  getSite,
  requireSubdomain,
  upsertKey,
} from '../sites.js';

// Signed requests older than this are refused, so a captured request can't
// be replayed later.
const MAX_AGE_MS = 5 * 60_000;
const LOGO_MAX_BYTES = 100 * 1024;
const LOGO_MAGIC = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

// Every owner request is { action, site, keyId, ts, payload }, signed by one
// of the site's active keys. The signature covers the exact request body.
export async function ownerAction(request, env, url) {
  const name = requireSubdomain(url, env);
  const body = await readText(request, 200 * 1024);
  const msg = parseJson(body);
  if (msg.site !== name || typeof msg.keyId !== 'string') {
    throw new HttpError(401, 'Not signed in');
  }
  if (!(Math.abs(Date.now() - msg.ts) <= MAX_AGE_MS)) {
    throw new HttpError(401, 'This request expired. Please try again.');
  }
  const row = await env.DB.prepare(
    'SELECT public_key FROM owner_keys WHERE site = ? AND id = ? AND revoked_at IS NULL',
  )
    .bind(name, msg.keyId)
    .first();
  const key = row && (await parsePublicKey(row.public_key));
  const signature = request.headers.get('X-Signature') || '';
  if (!key || !(await verifySignature(key.key, signature, body))) {
    throw new HttpError(401, 'Not signed in');
  }

  const action = ACTIONS[msg.action];
  if (!action) throw new HttpError(400, 'Unknown action');
  await action(env.DB, name, msg.payload ?? {});
  return json(await account(env.DB, name));
}

const ACTIONS = {
  async account() {},

  async update(db, name, payload) {
    const fields = brandFields(payload);
    const columns = Object.keys(fields);
    if (!columns.length) return;
    await db
      .prepare(
        `UPDATE sites SET ${columns.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE name = ?`,
      )
      .bind(...Object.values(fields), Date.now(), name)
      .run();
  },

  async add_key(db, name, payload) {
    const key = await parsePublicKey(payload.publicKey);
    if (!key) throw new HttpError(400, 'Invalid public key');
    const active = await getActiveKeys(db, name);
    if (!active.some((k) => k.id === key.id) && active.length >= MAX_KEYS) {
      throw new HttpError(
        400,
        `You can have up to ${MAX_KEYS} keys. Revoke one first.`,
      );
    }
    await upsertKey(
      db,
      name,
      {
        id: key.id,
        publicKey: payload.publicKey,
        label: cleanText(payload.label, 60),
      },
      Date.now(),
    ).run();
  },

  async revoke_key(db, name, payload) {
    const active = await getActiveKeys(db, name);
    if (!active.some((k) => k.id === payload.id)) return;
    if (active.length === 1) {
      throw new HttpError(400, "You can't revoke your only key.");
    }
    await db
      .prepare(
        'UPDATE owner_keys SET revoked_at = ? WHERE site = ? AND id = ? AND revoked_at IS NULL',
      )
      .bind(Date.now(), name, payload.id)
      .run();
  },

  async label_key(db, name, payload) {
    await db
      .prepare('UPDATE owner_keys SET label = ? WHERE site = ? AND id = ?')
      .bind(cleanText(payload.label, 60), name, String(payload.id))
      .run();
  },
};

// The owner's private view, including the email and key labels.
async function account(db, name) {
  const site = await getSite(db, name);
  const keys = await getActiveKeys(db, name);
  return {
    site: {
      name,
      email: site.email,
      title: site.title,
      accent: site.accent,
      logo: site.logo,
      showMakeOwn: Boolean(site.show_make_own),
    },
    keys: keys.map((k) => ({
      id: k.id,
      label: k.label,
      createdAt: k.created_at,
    })),
  };
}

function brandFields(payload) {
  const fields = {};
  if ('title' in payload) fields.title = cleanText(payload.title, 40);
  if ('accent' in payload) {
    if (payload.accent !== '' && !/^#[0-9a-f]{6}$/i.test(payload.accent)) {
      throw new HttpError(400, 'Choose a color like #1d4ed8');
    }
    fields.accent = payload.accent.toLowerCase();
  }
  if ('showMakeOwn' in payload) {
    fields.show_make_own = payload.showMakeOwn ? 1 : 0;
  }
  if ('logo' in payload) {
    fields.logo = payload.logo === null ? null : validLogo(payload.logo);
  }
  return fields;
}

// Logos are only ever shown with <img>. SVG is refused because it can carry
// scripts.
function validLogo(dataUrl) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      String(dataUrl),
    );
  let bytes = null;
  try {
    if (match) bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  } catch {
    // Reported below.
  }
  if (!bytes) throw new HttpError(400, 'Upload a PNG, JPEG or WebP image');
  if (bytes.length > LOGO_MAX_BYTES) {
    throw new HttpError(400, 'Logos must be 100 KB or smaller');
  }
  const type = match[1];
  const webpOk =
    type !== 'image/webp' ||
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!LOGO_MAGIC[type].every((b, i) => bytes[i] === b) || !webpOk) {
    throw new HttpError(400, "That file isn't a valid PNG, JPEG or WebP image");
  }
  return dataUrl;
}
