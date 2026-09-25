# multilink

One link that opens multiple links at once.

**Multilinks** bundles your work, blogs, songs, meeting links and more. Add your links, click **Copy multilink**, and paste the link anywhere. When someone clicks it, every link opens in a new tab, with the main (top) link opened last so it lands in front. The multilink page stays behind them as a list of the links.

Everything lives in a single `index.html` with no build step and no dependencies.

## How it works

- With no `#` in the URL, the page shows the link builder.
- With a `#` fragment, the page opens the links. The format is `#A=<encoded url>&B=<encoded url>&…`, each URL encoded with `encodeURIComponent`. The fragment is never sent to a server ([RFC 7230, section 5.1](https://datatracker.ietf.org/doc/html/rfc7230#section-5.1)).
- Turning on **Always show the list first** adds `&list=1`. Then nothing opens automatically: people see the list and open single links or click **Open all links**.
- Only `http://` and `https://` links are accepted. A link typed without a protocol gets `https://` added.
- If the browser blocks the new tabs, the page shows the list with an **Open all links** button and explains how to allow pop-ups so it opens everything automatically next time.

## Deploy to GitHub Pages

1. Merge the pull request into `main`.
2. On GitHub, open the repo, then **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Set **Branch** to `main` and the folder to `/ (root)`, then click **Save**.
5. Wait a minute or two, then refresh the Pages settings. The site is live at `https://adverbly.github.io/multilink/`.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```
