// Stand-ins for the parts of Stripe and Resend the Worker uses, so the
// browser tests run offline. Started by playwright.config.js.
import { createServer } from 'node:http';

const PORT = 8790;
const sessions = new Map();
const emails = [];

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), {
    'Content-Type': 'application/json',
  });
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const [, first, second] = url.pathname.split('/');
  if (first === 'health') return send(res, 200, 'ok');

  // Resend. The tests read the sent emails back from GET /emails.
  if (first === 'emails') {
    if (req.method === 'GET') return sendJson(res, 200, emails);
    emails.push(JSON.parse(await readBody(req)));
    return sendJson(res, 200, { id: `email_${emails.length}` });
  }

  // Stripe Checkout.
  if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
    const form = new URLSearchParams(await readBody(req));
    const id = `cs_test_${sessions.size + 1}`;
    const session = {
      id,
      object: 'checkout.session',
      url: `http://localhost:${PORT}/pay/${id}`,
      payment_status: 'unpaid',
      success_url: form.get('success_url'),
      metadata: {
        claim_id: form.get('metadata[claim_id]'),
        site: form.get('metadata[site]'),
      },
      customer_details: { email: 'owner@example.com' },
    };
    sessions.set(id, session);
    return sendJson(res, 200, session);
  }
  if (req.method === 'GET' && url.pathname.startsWith('/v1/checkout/')) {
    const session = sessions.get(url.pathname.split('/').pop());
    if (session) return sendJson(res, 200, session);
    return sendJson(res, 404, { error: { message: 'No such session' } });
  }

  // The hosted payment page.
  if (first === 'pay' && sessions.has(second)) {
    const session = sessions.get(second);
    if (req.method === 'POST') {
      session.payment_status = 'paid';
      const next = session.success_url.replace(
        '{CHECKOUT_SESSION_ID}',
        session.id
      );
      return send(res, 303, '', { Location: next });
    }
    return send(
      res,
      200,
      `<!doctype html><title>Fake Checkout</title><h1>Fake Checkout</h1>
       <form method="post"><button>Pay now</button></form>`,
      { 'Content-Type': 'text/html' }
    );
  }

  send(res, 404, 'Not found');
}).listen(PORT, () => console.log(`Fakes on http://localhost:${PORT}`));
