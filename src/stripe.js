import { hmacSha256Hex, safeEqual } from './crypto.js';

const API_VERSION = '2026-04-22.dahlia';
const WEBHOOK_TOLERANCE_SECONDS = 300;

// Stripe takes nested form fields: line_items[0][price]=...
function toForm(params, prefix = '', form = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value !== null && typeof value === 'object') toForm(value, name, form);
    else form.append(name, String(value));
  }
  return form;
}

async function stripe(env, method, path, params) {
  const res = await fetch(
    (env.STRIPE_API_BASE || 'https://api.stripe.com') + path,
    {
      method,
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Stripe-Version': API_VERSION,
      },
      body: params && toForm(params),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Stripe ${method} ${path} failed: ${data.error?.message || res.status}`
    );
  }
  return data;
}

export function createCheckoutSession(
  env,
  { claimId, site, origin, expiresAt }
) {
  return stripe(env, 'POST', '/v1/checkout/sessions', {
    mode: 'payment',
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    managed_payments:
      env.STRIPE_MANAGED_PAYMENTS === 'false' ? undefined : { enabled: true },
    success_url: `${origin}/claim?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/claim`,
    client_reference_id: claimId,
    metadata: { claim_id: claimId, site },
    expires_at: Math.floor(expiresAt / 1000),
  });
}

export function getCheckoutSession(env, id) {
  return stripe(env, 'GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);
}

// Returns the event if the Stripe-Signature header is valid and recent.
export async function verifyWebhook(env, payload, header, now = Date.now()) {
  let timestamp = 0;
  const signatures = [];
  for (const part of (header || '').split(',')) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1' && value) signatures.push(value);
  }
  if (Math.abs(now / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return null;
  const expected = await hmacSha256Hex(
    env.STRIPE_WEBHOOK_SECRET,
    `${timestamp}.${payload}`
  );
  return signatures.some((s) => safeEqual(s, expected))
    ? JSON.parse(payload)
    : null;
}
