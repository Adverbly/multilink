# multilink

One link that opens multiple links at once.

**Multilinks** bundles your work, blogs, songs, meeting links and more. Add your links, click **Copy multilink**, and paste the link anywhere. When someone clicks it, every link opens in a new tab, with the main (top) link opened last so it lands in front. The multilink page stays behind them as a list of the links.

The whole app is one page, `public/index.html`, with no build step. A small Cloudflare Worker in `src/` serves it and runs the API for branded subdomains.

## How it works

- With no `#` in the URL, the page shows the link builder.
- With a `#` fragment, the page opens the links. The format is `#A=<encoded url>&B=<encoded url>&…`, each URL encoded with `encodeURIComponent`. The fragment is never sent to a server ([RFC 7230, section 5.1](https://datatracker.ietf.org/doc/html/rfc7230#section-5.1)).
- **Always show list first** is on by default and adds `&list=1`. Then nothing opens automatically: people see the list and open single links or click **Open all links**.
- Paste an existing multilink into any link field to load all of its links for editing, or click **Clone this multilink** on a multilink's list page (it opens the builder via `&edit=1`).
- Only `http://` and `https://` links are accepted. A link typed without a protocol gets `https://` added.
- If the browser blocks the new tabs, the page shows the list with an **Open all links** button and explains how to allow pop-ups so it opens everything automatically next time.

## Branded subdomains

For a one-time payment, anyone can claim `<name>.<your domain>` with their own logo, accent color and title, and hide "Make your own multilink". Only the owner can create multilinks there.

- **Owner keys.** Before checkout, the buyer's browser makes an ECDSA P-256 key pair. The private key stays in that browser's IndexedDB (non-extractable), and the buyer saves a copy as a key file. The public key travels with the Stripe Checkout Session and is activated when the payment completes.
- **Signed multilinks.** When the owner copies a multilink, their browser signs the links and adds `&sign=<signature>`. Visitors' browsers check it against the subdomain's public keys, so copying a link still makes no server request and the links still never reach the server. Unsigned or changed links are refused.
- **Settings.** Branding and key changes are requests signed by an owner key, with a timestamp that must be within 5 minutes of the server's clock. Owners can have up to 10 keys, one per device, and sign in on a new device with a key file.
- **Lost keys.** "Email me a recovery link" sends a single-use link (valid for 30 minutes) to the email from checkout. It lets the owner add a key and revoke lost ones. Requests are limited to 1 an hour and 3 a day per subdomain, plus a global daily cap.
- **Privacy.** The database holds each subdomain's branding, the checkout email and the public keys with their labels. `/api/brand` is the only public read, and it never includes the email or key labels.

## Run locally

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill in Stripe test keys
npm run dev
```

Open http://localhost:8787 for the main site and http://acme.localhost:8787 for a subdomain. Recovery emails are printed to the console.

To try buying a subdomain without a Stripe account, run `node e2e/fakes.js` in another terminal and add `STRIPE_API_BASE=http://localhost:8790` to `.dev.vars`. The fake checkout page has a single **Pay now** button.

## Tests

```sh
npm test               # Worker API tests (Vitest, in the Workers runtime)
npm run test:e2e       # browser tests (Playwright) against fake Stripe and Resend
```

Run `npx playwright install chromium` once before the first browser test run.

## Deploy to Cloudflare

These steps use `multilinks.app` as the domain. Replace it everywhere with yours, including in `wrangler.jsonc`.

1. Add the domain to Cloudflare, and sign in with `npx wrangler login`.
2. Create the database with `npx wrangler d1 create multilinks`, copy its `database_id` into `wrangler.jsonc`, then run `npx wrangler d1 migrations apply DB --remote`.
3. In `wrangler.jsonc`, set `ROOT_DOMAIN`, `EMAIL_FROM` and `PRICE_DISPLAY`, and uncomment `routes`.
4. In Cloudflare DNS, add a proxied `AAAA` record for `*` pointing to `100::`, so every subdomain reaches the Worker. Cloudflare's free certificate already covers `*.multilinks.app`.
5. In Stripe, turn on Managed Payments, create a product with a one-time price, and put the price's ID in `STRIPE_PRICE_ID`. Add a webhook endpoint for `https://multilinks.app/api/stripe/webhook` that sends `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
6. In Resend, verify the domain you send from and create an API key.
7. Add the secrets:
   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   npx wrangler secret put RESEND_API_KEY
   ```
8. Run `npm run deploy`.

If two payments ever complete for the same subdomain, the second buyer sees a message and the Worker logs `Refund checkout session …`. Refund that session from the Stripe Dashboard.
