# multilink

One link that opens multiple links at once.

**Multilinks** bundles your work, blogs, songs, meeting links and more. Add your links, click **Copy multilink**, and paste the link anywhere. When someone clicks it, every link opens in a new tab, with the main (top) link opened last so it lands in front. The multilink page stays behind them as a list of the links.

Everything lives in a single `index.html` with no build step and no dependencies.

## How it works

- With no `#` in the URL, the page shows the link builder.
- With a `#` fragment, the page opens the links. The format is `#A=<encoded url>&B=<encoded url>&…`, each URL encoded with `encodeURIComponent`. The fragment is never sent to a server ([RFC 7230, section 5.1](https://datatracker.ietf.org/doc/html/rfc7230#section-5.1)).
- **Always show list first** is on by default and adds `&list=1`. Then nothing opens automatically: people see the list and open single links or click **Open all links**.
- Paste an existing multilink into any link field to load all of its links for editing, or click **Clone this multilink** on a multilink's list page (it opens the builder via `&edit=1`).
- Only `http://` and `https://` links are accepted. A link typed without a protocol gets `https://` added.
- If the browser blocks the new tabs, the page shows the list with an **Open all links** button and explains how to allow pop-ups so it opens everything automatically next time.

## Deploy to Cloudflare Pages

The site is one static file with no build step, so it can be served from any static host.

1. In the Cloudflare dashboard, open **Workers & Pages**, click **Create**, choose **Pages**, then connect GitHub and pick this repo.
2. Set the production branch to `main`, the framework preset to **None**, leave the build command empty, and set the build output directory to `/`.
3. Click **Save and Deploy**. The site is live at `https://<project-name>.pages.dev/`, and every push to `main` redeploys it.
4. To use your own domain, open the project's **Custom domains** tab and add it. A subdomain on any DNS provider works with a CNAME to the `pages.dev` address. A root domain (like `example.com`) needs its DNS on Cloudflare.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```
