import { HttpError, json } from '../http.js';
import {
  availability,
  getActiveKeys,
  getSite,
  nameProblem,
  rootOrigin,
  siteOrigin,
  subdomainOf,
} from '../sites.js';

// Everything a page needs to brand itself and verify links. Public, so it
// never includes the owner's email or key labels.
export async function getBrand(request, env, url) {
  const now = Date.now();
  const name = subdomainOf(url, env);
  if (name === null) {
    return json({
      type: 'root',
      root: rootOrigin(url, env),
      price: env.PRICE_DISPLAY,
      now,
    });
  }

  const root = rootOrigin(url, env);
  const problem = nameProblem(name);
  const site = !problem && (await getSite(env.DB, name));
  if (!site) {
    return json({
      type: 'unclaimed',
      name,
      status: problem || (await availability(env.DB, name, now)),
      price: env.PRICE_DISPLAY,
      root,
      now,
    });
  }

  const keys = await getActiveKeys(env.DB, name);
  return json({
    type: 'brand',
    name,
    title: site.title,
    accent: site.accent,
    logo: site.logo,
    showMakeOwn: Boolean(site.show_make_own),
    keys: keys.map((k) => ({ id: k.id, publicKey: k.public_key })),
    root,
    now,
  });
}

export async function getAvailability(request, env, url) {
  const name = url.pathname.split('/').pop().toLowerCase();
  if (subdomainOf(url, env) !== null) throw new HttpError(404, 'Not found');
  const status = nameProblem(name) || (await availability(env.DB, name));
  return json({
    name,
    status,
    url: status === 'available' ? siteOrigin(url, env, name) + '/claim' : null,
    price: env.PRICE_DISPLAY,
  });
}
