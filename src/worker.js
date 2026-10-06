import { HttpError, json } from './http.js';
import { getAvailability, getBrand } from './routes/brand.js';
import {
  confirmCheckout,
  startCheckout,
  stripeWebhook,
} from './routes/checkout.js';
import { ownerAction } from './routes/owner.js';
import {
  applyRecovery,
  recoveryKeys,
  requestRecovery,
} from './routes/recovery.js';

const routes = {
  'GET /api/brand': getBrand,
  'POST /api/checkout': startCheckout,
  'POST /api/checkout/confirm': confirmCheckout,
  'POST /api/stripe/webhook': stripeWebhook,
  'POST /api/owner': ownerAction,
  'POST /api/recovery': requestRecovery,
  'POST /api/recovery/keys': recoveryKeys,
  'POST /api/recovery/apply': applyRecovery,
};

function routeFor(method, path) {
  if (method === 'GET' && /^\/api\/subdomains\/[^/]+$/.test(path)) {
    return getAvailability;
  }
  return routes[`${method} ${path}`];
}

export default {
  // Static files are served before the Worker runs; only /api/* reaches it.
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const route = routeFor(request.method, url.pathname);
      if (!route) throw new HttpError(404, 'Not found');
      return await route(request, env, url, ctx);
    } catch (err) {
      if (err instanceof HttpError)
        return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
};
