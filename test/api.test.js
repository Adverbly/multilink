import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hmacSha256Hex, toBase64Url } from '../src/crypto.js';
import worker from '../src/worker.js';

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
// A 1x1 PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function call(host, path, { method = 'GET', body, headers } = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://${host}${path}`, {
      method,
      headers,
      body: typeof body === 'string' ? body : body && JSON.stringify(body),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, data: await res.json() };
}

const site = (name) => `${name}.multilinks.test`;

async function newKey() {
  const pair = await crypto.subtle.generateKey(ECDSA, false, [
    'sign',
    'verify',
  ]);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  const digest = await crypto.subtle.digest('SHA-256', raw);
  return {
    privateKey: pair.privateKey,
    publicKey: toBase64Url(raw),
    id: toBase64Url(digest).slice(0, 16),
  };
}

async function ownerCall(name, key, action, payload, overrides = {}) {
  const body = JSON.stringify({
    action,
    site: name,
    keyId: key.id,
    ts: Date.now(),
    payload,
    ...overrides,
  });
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key.privateKey,
    new TextEncoder().encode(body),
  );
  return call(site(name), '/api/owner', {
    method: 'POST',
    body,
    headers: { 'X-Signature': toBase64Url(signature) },
  });
}

async function webhook(event, secret = 'whsec_test') {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = await hmacSha256Hex(secret, `${t}.${payload}`);
  return call('multilinks.test', '/api/stripe/webhook', {
    method: 'POST',
    body: payload,
    headers: { 'Stripe-Signature': `t=${t},v1=${v1}` },
  });
}

// Stands in for Stripe and Resend.
let stripeSessions, emails;
beforeEach(() => {
  stripeSessions = new Map();
  emails = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input);
    if (url.hostname === 'api.resend.com') {
      emails.push(JSON.parse(init.body));
      return Response.json({ id: 'email_1' });
    }
    if (init?.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const form = new URLSearchParams(init.body);
      const session = {
        id: `cs_test_${stripeSessions.size + 1}`,
        url: 'https://checkout.stripe.test/pay',
        form,
        payment_status: 'unpaid',
        metadata: {
          claim_id: form.get('metadata[claim_id]'),
          site: form.get('metadata[site]'),
        },
        customer_details: { email: 'owner@example.com' },
      };
      stripeSessions.set(session.id, session);
      return Response.json(session);
    }
    const session = stripeSessions.get(url.pathname.split('/').pop());
    if (session) return Response.json(session);
    return Response.json({ error: { message: 'Not found' } }, { status: 404 });
  });
});
afterEach(() => vi.restoreAllMocks());

// Checks out `name` with a fresh key and returns { key, session }.
async function checkout(name) {
  const key = await newKey();
  const res = await call(site(name), '/api/checkout', {
    method: 'POST',
    body: { publicKey: key.publicKey, label: 'Chrome on Mac' },
  });
  expect(res.status).toBe(200);
  return { key, session: [...stripeSessions.values()].at(-1) };
}

function paidEvent(session) {
  session.payment_status = 'paid';
  return {
    type: 'checkout.session.completed',
    data: { object: session },
  };
}

describe('buying a subdomain', () => {
  it('holds the name during checkout and activates it when Stripe says it was paid', async () => {
    expect((await call(site('acme'), '/api/brand')).data).toMatchObject({
      type: 'unclaimed',
      status: 'available',
      price: '$5.99',
      root: 'https://multilinks.test',
    });

    const { key, session } = await checkout('acme');
    expect(session.form.get('managed_payments[enabled]')).toBe('true');
    expect(session.form.get('success_url')).toBe(
      'https://acme.multilinks.test/claim?session_id={CHECKOUT_SESSION_ID}',
    );

    expect(
      (await call('multilinks.test', '/api/subdomains/acme')).data.status,
    ).toBe('pending');
    const other = await newKey();
    expect(
      (
        await call(site('acme'), '/api/checkout', {
          method: 'POST',
          body: { publicKey: other.publicKey },
        })
      ).status,
    ).toBe(409);

    expect((await webhook(paidEvent(session), 'whsec_wrong')).status).toBe(400);
    expect((await webhook(paidEvent(session))).status).toBe(200);
    expect((await webhook(paidEvent(session))).status).toBe(200);

    const brand = (await call(site('acme'), '/api/brand')).data;
    expect(brand).toMatchObject({
      type: 'brand',
      name: 'acme',
      showMakeOwn: true,
      keys: [{ id: key.id, publicKey: key.publicKey }],
    });
    expect(JSON.stringify(brand)).not.toContain('owner@example.com');
    expect(
      (await call('multilinks.test', '/api/subdomains/acme')).data.status,
    ).toBe('taken');
  });

  it('activates from the success page without waiting for the webhook', async () => {
    const { key, session } = await checkout('bravo');
    const confirm = () =>
      call(site('bravo'), '/api/checkout/confirm', {
        method: 'POST',
        body: { sessionId: session.id },
      });

    expect((await confirm()).data.status).toBe('pending');
    session.payment_status = 'paid';
    expect((await confirm()).data.status).toBe('active');
    expect((await ownerCall('bravo', key, 'account')).data.site.email).toBe(
      'owner@example.com',
    );
  });

  it('refuses names that are not valid subdomains', async () => {
    for (const name of ['www', 'xn--pypal-4ve', '-acme', 'a'.repeat(64)]) {
      const res = await call('multilinks.test', `/api/subdomains/${name}`);
      expect(res.data.status).not.toBe('available');
    }
  });
});

describe('owner requests', () => {
  let key,
    name,
    count = 0;
  beforeEach(async () => {
    name = `charlie${++count}`;
    const claimed = await checkout(name);
    key = claimed.key;
    await webhook(paidEvent(claimed.session));
  });

  it('updates branding when signed by an active key', async () => {
    const res = await ownerCall(name, key, 'update', {
      title: 'Charlie Co',
      accent: '#0F766E',
      logo: PNG,
      showMakeOwn: false,
    });
    expect(res.status).toBe(200);
    expect(res.data.keys).toEqual([
      { id: key.id, label: 'Chrome on Mac', createdAt: expect.any(Number) },
    ]);
    expect((await call(site(name), '/api/brand')).data).toMatchObject({
      title: 'Charlie Co',
      accent: '#0f766e',
      logo: PNG,
      showMakeOwn: false,
    });

    const svg = 'data:image/svg+xml;base64,' + btoa('<svg onload="x()"/>');
    expect((await ownerCall(name, key, 'update', { logo: svg })).status).toBe(
      400,
    );
  });

  it('refuses unsigned, stale, foreign and tampered requests', async () => {
    const stranger = await newKey();
    expect(
      (await ownerCall(name, stranger, 'account', {}, { keyId: key.id }))
        .status,
    ).toBe(401);
    expect(
      (
        await ownerCall(
          name,
          key,
          'account',
          {},
          { ts: Date.now() - 6 * 60_000 },
        )
      ).status,
    ).toBe(401);
    expect(
      (await ownerCall(name, key, 'account', {}, { site: 'acme' })).status,
    ).toBe(401);

    const tampered = await call(site(name), '/api/owner', {
      method: 'POST',
      body: {
        action: 'update',
        site: name,
        keyId: key.id,
        ts: Date.now(),
        payload: { title: 'Pwned' },
      },
      headers: { 'X-Signature': 'AAAA' },
    });
    expect(tampered.status).toBe(401);
  });

  it('adds up to 10 keys and never revokes the last one', async () => {
    const keys = [key];
    for (let i = 1; i < 10; i++) {
      const next = await newKey();
      const res = await ownerCall(name, key, 'add_key', {
        publicKey: next.publicKey,
        label: `Device ${i}`,
      });
      expect(res.status).toBe(200);
      keys.push(next);
    }
    const eleventh = await newKey();
    expect(
      (await ownerCall(name, key, 'add_key', { publicKey: eleventh.publicKey }))
        .status,
    ).toBe(400);

    for (const k of keys.slice(1)) {
      expect(
        (await ownerCall(name, key, 'revoke_key', { id: k.id })).status,
      ).toBe(200);
    }
    expect(
      (await ownerCall(name, key, 'revoke_key', { id: key.id })).status,
    ).toBe(400);
    expect((await call(site(name), '/api/brand')).data.keys).toHaveLength(1);

    // A revoked key can't sign anything any more.
    expect((await ownerCall(name, keys[1], 'account')).status).toBe(401);
  });
});

describe('forgot key', () => {
  it('emails a single-use link that can add a key and revoke the lost one', async () => {
    const { key: lost, session } = await checkout('delta');
    await webhook(paidEvent(session));

    const request = () =>
      call(site('delta'), '/api/recovery', { method: 'POST' });
    expect((await request()).data).toEqual({ ok: true });
    expect((await request()).status).toBe(429);
    // Same answer for a subdomain nobody owns, and no email.
    expect(
      (await call(site('echo'), '/api/recovery', { method: 'POST' })).data,
    ).toEqual({ ok: true });

    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('owner@example.com');
    const token = /\/recover#t=([\w-]+)/.exec(emails[0].text)[1];

    const keys = await call(site('delta'), '/api/recovery/keys', {
      method: 'POST',
      body: { token },
    });
    expect(keys.data.keys).toEqual([
      { id: lost.id, label: 'Chrome on Mac', createdAt: expect.any(Number) },
    ]);

    const fresh = await newKey();
    const apply = () =>
      call(site('delta'), '/api/recovery/apply', {
        method: 'POST',
        body: {
          token,
          addKey: { publicKey: fresh.publicKey, label: 'New laptop' },
          revoke: [lost.id],
        },
      });
    expect((await apply()).status).toBe(200);
    expect((await apply()).status).toBe(401);

    expect((await call(site('delta'), '/api/brand')).data.keys).toEqual([
      { id: fresh.id, publicKey: fresh.publicKey },
    ]);
    expect((await ownerCall('delta', fresh, 'account')).status).toBe(200);
  });
});
