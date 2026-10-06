import { parsePublicKey, randomToken } from '../crypto.js';
import { HttpError, json, readJson, readText } from '../http.js';
import {
  cleanText,
  getSite,
  nameProblem,
  requireSubdomain,
  upsertKey,
} from '../sites.js';
import {
  createCheckoutSession,
  getCheckoutSession,
  verifyWebhook,
} from '../stripe.js';

const MINUTE = 60_000;
// Stripe requires sessions to last at least 30 minutes. Claims are held a
// little longer so a last-second payment can't collide with a new claim.
const SESSION_MINUTES = 31;
const HOLD_MINUTES = 45;
const PAID_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);

// The browser makes the owner's key pair before paying, so the public key
// rides along with the payment and is active the moment it completes.
export async function startCheckout(request, env, url) {
  const name = requireSubdomain(url, env);
  const { publicKey, label } = await readJson(request);
  if (!(await parsePublicKey(publicKey))) {
    throw new HttpError(400, 'Invalid public key');
  }
  if (await getSite(env.DB, name)) {
    throw new HttpError(409, 'This subdomain is already taken.');
  }

  const now = Date.now();
  const claimId = randomToken(16);
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE claims SET status = 'expired' WHERE site = ? AND status = 'pending' AND (expires_at <= ? OR public_key = ?)",
      ).bind(name, now, publicKey),
      env.DB.prepare(
        "INSERT INTO claims (id, site, public_key, key_label, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
      ).bind(
        claimId,
        name,
        publicKey,
        cleanText(label, 60),
        now,
        now + HOLD_MINUTES * MINUTE,
      ),
    ]);
  } catch (err) {
    if (!String(err.message).includes('UNIQUE')) throw err;
    throw new HttpError(
      409,
      'Someone else is checking out this subdomain right now. Try again in an hour.',
    );
  }

  let session;
  try {
    session = await createCheckoutSession(env, {
      claimId,
      site: name,
      origin: url.origin,
      expiresAt: now + SESSION_MINUTES * MINUTE,
    });
  } catch (err) {
    console.error(err);
    await env.DB.prepare("UPDATE claims SET status = 'failed' WHERE id = ?")
      .bind(claimId)
      .run();
    throw new HttpError(502, "Couldn't start checkout. Please try again.");
  }
  await env.DB.prepare('UPDATE claims SET session_id = ? WHERE id = ?')
    .bind(session.id, claimId)
    .run();
  return json({ url: session.url });
}

// Called by the page Stripe redirects back to, so the owner doesn't have to
// wait for the webhook.
export async function confirmCheckout(request, env, url) {
  const name = requireSubdomain(url, env);
  const { sessionId } = await readJson(request);
  if (typeof sessionId !== 'string' || !/^cs_\w+$/.test(sessionId)) {
    throw new HttpError(400, 'Invalid checkout session');
  }
  const session = await getCheckoutSession(env, sessionId);
  if (session.metadata?.site !== name) {
    throw new HttpError(400, 'Invalid checkout session');
  }
  if (session.payment_status !== 'paid') return json({ status: 'pending' });
  return json({ status: await activateClaim(env.DB, session) });
}

export async function stripeWebhook(request, env) {
  const payload = await readText(request, 512 * 1024);
  const event = await verifyWebhook(
    env,
    payload,
    request.headers.get('Stripe-Signature'),
  );
  if (!event) throw new HttpError(400, 'Invalid signature');
  const session = event.data?.object;
  if (PAID_EVENTS.has(event.type) && session?.payment_status === 'paid') {
    await activateClaim(env.DB, session);
  }
  return json({ received: true });
}

// Idempotent: the webhook and the success page both call this.
// Returns 'active', 'conflict' or 'unknown'.
export async function activateClaim(db, session) {
  const claim = await db
    .prepare('SELECT * FROM claims WHERE id = ?')
    .bind(session.metadata?.claim_id ?? '')
    .first();
  if (!claim || nameProblem(claim.site)) return 'unknown';

  const site = await getSite(db, claim.site);
  if (site) {
    if (site.claim_id === claim.id) return 'active';
    await db
      .prepare("UPDATE claims SET status = 'conflict' WHERE id = ?")
      .bind(claim.id)
      .run();
    console.error(
      `Claim ${claim.id} paid for ${claim.site}, which is already taken. Refund checkout session ${session.id}.`,
    );
    return 'conflict';
  }

  const key = await parsePublicKey(claim.public_key);
  const email = session.customer_details?.email || session.customer_email || '';
  const now = Date.now();
  try {
    await db.batch([
      db
        .prepare(
          'INSERT INTO sites (name, email, claim_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(claim.site, email, claim.id, now, now),
      upsertKey(
        db,
        claim.site,
        { id: key.id, publicKey: claim.public_key, label: claim.key_label },
        now,
      ),
      db
        .prepare(
          "UPDATE claims SET status = 'active', session_id = ? WHERE id = ?",
        )
        .bind(session.id, claim.id),
    ]);
  } catch (err) {
    // Lost a race with a concurrent activation; the retry sees its result.
    if (String(err.message).includes('UNIQUE'))
      return activateClaim(db, session);
    throw err;
  }
  return 'active';
}
