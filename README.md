# multilink

One link that opens multiple links at once.

Add your meeting links (for example a Zoom link and the agenda doc), click **Copy link**, and paste the combo link into the invite. When someone clicks it, the first link opens in the same tab and every other link opens in a new tab.

Everything lives in a single `index.html` with no build step and no dependencies.

## How it works

- With no `#` in the URL, the page shows the link builder.
- With a `#` fragment, the page opens the links. The format is `#A=<encoded url>&B=<encoded url>&…`, each URL encoded with `encodeURIComponent`. The fragment is never sent to a server.
- Only `http://` and `https://` links are accepted. A link typed without a protocol gets `https://` added.
- If the browser blocks the new tabs, the page doesn't redirect. It explains how to allow pop-ups and offers an **Open all links** button plus each link individually.

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
