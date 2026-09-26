# juliet.nyc

Landing page for **juliet.nyc**. Hello Kitty pink, with NYC Ferry running through it.

Node.js, zero dependencies. The page itself is plain HTML/CSS with inline SVG icons —
no CDN, no build step, no `npm install`.

```bash
npm start                      # http://127.0.0.1:8000
npm run dev                    # same, with --watch reload
PORT=3000 node server.js       # pick a port
npm test                       # server, content, and (optionally) browser tests
```

`server.js` binds `127.0.0.1` by default. Set `HOST=0.0.0.0` only if you want it
facing the network directly instead of sitting behind nginx.

## What's here

```
index.html      the page
blog/index.html the blog ("ship log")
css/style.css   all styling (colors live in :root at the top)
js/main.js      status lamps + copy buttons — progressive enhancement, page works without it
js/posts.js     renders blog headlines (landing) and full posts (/blog)
server.js       static server + /_api/status
projects.json   which projects get health-checked
posts.json      the blog posts themselves
images/         your photos go here (see images/README.md)
test/           npm test (node:test, no dependencies)
```

Only the public site is served: `index.html`, `posts.json`, and whatever is in
`blog/`, `css/`, `js/` and `images/`. Everything else in the repo (this README,
`server.js`, `deploy/`, dotfiles) 404s. If you add a new top-level file or folder the
page needs, add it to `PUBLIC_FILES` / `PUBLIC_DIRS` at the top of `server.js`.

HTML, CSS, JS and `posts.json` are served with `no-cache` plus an ETag, so browsers
check back on every load (a cheap 304 when nothing changed) and a deploy or a new post
shows up right away. Images are cached for an hour.

## The "live now" sidebar

The left sidebar links to things actually running on the box. Each link has a status
lamp that goes green when the project answers, red when it doesn't.

To add a project, do both halves:

1. **`index.html`** — copy the `<li>` inside `.live-list`, set the `href`, the display
   name, and a unique `data-project` id.
2. **`projects.json`** — add an entry with that same `id` plus a `probe` URL.

`npm test` fails if the two halves don't match.

`projects.json` is an allowlist, not a config the page passes in: `/_api/status` will
only ever fetch URLs listed there, so the endpoint can't be used as an open proxy.
Results are cached for 30s; the browser re-polls every 60s while the tab is visible,
and again when you come back to it.

### Downloads

Under the live links, **downloads** has [lb](https://github.com/jefuhr/lb) — a boat
that sails across your terminal. The row links to the install instructions on GitHub,
its lamp watches the installer the box serves at `https://juliet.nyc/lb/install.sh`,
and underneath is the one-liner in a little terminal with a copy button:

```sh
curl -fsSL https://juliet.nyc/lb/install.sh | sh
```

## The blog

`/blog/` is the blog. Every post lives in **`posts.json`** — that file is the only
place a post is written down, and both the blog page and the "from the blog" card in
the landing page sidebar render from it. Add an entry and it shows up in both.

```json
{
  "slug": "hello-harbor",        // anchor: /blog/#hello-harbor — lowercase-words-with-dashes
  "title": "Hello, harbor",
  "date": "2026-08-10",          // YYYY-MM-DD; posts sort newest first
  "tag": "ship log",             // optional pill next to the date
  "summary": "One line, shown under the headline on the landing page.",
  "body": ["First paragraph.", "Second paragraph with [a link](/ferryTimesMobile)."]
}
```

`body` is a list of paragraphs of plain text — no HTML, no build step. Markdown links,
`[text](url)`, are the one bit of markup: they become real links for `http(s)`,
`mailto:` and same-site URLs, and anything else is left as written. The sidebar card
shows the three newest headlines and links each one to its anchor on the blog page,
where the post gets highlighted; change `HEADLINE_COUNT` in `js/posts.js` for a
different number.

Run `npm test` after editing: it catches broken JSON (a stray `}` takes the whole blog
down), slugs that won't work as anchors, duplicate slugs, and dates that aren't dates.

Rendering happens in the browser, so with JavaScript off the blog page points at
`posts.json` and the sidebar card falls back to a plain link to `/blog/`.

## Tests

```bash
npm test
CHROME_BIN=/usr/bin/chromium npm test     # also run the headless-browser tests
```

- `test/server.test.js` — starts `server.js` on a random port and checks caching, the
  public-files allowlist, and that malformed URLs get a 400 instead of killing the server.
- `test/content.test.js` — `posts.json`, `projects.json` ↔ `index.html`, local links
  in both pages (including filename case), and the nginx lb include.
- `test/e2e.test.js` — loads both pages in headless Chrome and checks what the
  JavaScript drew. Skipped unless `CHROME_BIN` is set. From WSL, Windows Chrome works:
  `CHROME_BIN="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" npm test`.

## Deploying to the AWS box

Already live. `juliet.nyc` runs two Node apps and one folder of static files behind
one nginx + certbot cert:

| Path | What | Where | Service |
|---|---|---|---|
| `/` and `/blog/` | this landing page | port 3000 | `juliet-landing.service` |
| `/ferryTimesMobile/` | ferry departure display | port 8090 | `nyc-ferry-did.service` |
| `/lb/` | lb installer + releases | `/var/www/lb` | nginx (from [jefuhr/lb](https://github.com/jefuhr/lb)) |

To ship a change:

```bash
npm test                      # first
./deploy/deploy.sh            # sync code + restart the landing service
./deploy/deploy.sh --nginx    # also reinstall the nginx site config
```

The script tars the repo to `/opt/juliet-landing` (minus `.git`, `.claude`, `test`
and `deploy`), installs the systemd unit, waits for the service to answer, and curls
every app from the outside to prove nothing broke. The `--nginx` path backs up the
live config first and puts it straight back if `nginx -t` fails, so a bad config
never gets loaded. Host and key come from `DEPLOY_HOST` / `DEPLOY_KEY` (defaults:
`ubuntu@52.5.187.46`, `~/julie.pem`).

### Why the routing looks the way it does

The board was written to sit at a domain root: its HTML asks for `/app.js`,
`/styles.css`, `/assets/…` and it fetches `/api/landings`, `/api/alerts`,
`/api/realtime`, `/api/display-data`, `/api/override`. Moving it to a subpath would
have broken every one of those.

Rather than patch the board, `deploy/nginx-juliet.nyc.conf` routes those root paths
back to it, and the landing page stays out of their way — it uses `/css/`, `/js/`,
`/images/`, `/blog/`, `/posts.json` and `/_api/status`. **If you add a route to the
landing page, keep clear of the board's paths above and of `/lb/`**, or they'll break.

`/lb/` comes from lb's own `scripts/setup-server.sh`, which drops a snippet in
`/etc/nginx/snippets/lb.conf` and includes it between `# >>> lb >>>` / `# <<< lb <<<`
marker lines. That same include block is in `deploy/nginx-juliet.nyc.conf`, so
`deploy.sh --nginx` keeps lb working; leave the marker lines exactly as they are
(space-indented), because lb's script looks for them.

Rollback: the nginx configs are backed up on the box as
`/etc/nginx/sites-available/nyc-ferry-did.bak-<timestamp>`.


## Where to edit things

| What | Where |
|---|---|
| Name, tagline, intro | `index.html` → `.masthead` and `#about` |
| Social links | `index.html` → `.socials` |
| Photos | drop files in `images/` — see `images/README.md` |
| Live project links | `index.html` → `.live-list` **and** `projects.json` |
| Downloads | `index.html` → the `.live-list` under "downloads" (plus `projects.json` for the lamp) |
| Blog posts | `posts.json` |
| Colors | `css/style.css` → `:root` for the day palette, the `prefers-color-scheme: dark` block right under it for night |

## Ferry bits

- A ferry sails the wave band under the header on a 26s loop, bobbing and smoking.
- After dark (when your system is in dark mode) it's the night harbor: stars over the
  water, and the ferry's portholes light up.
- Going between the landing page and the blog, the kitty and the harbor stay put while
  the rest crossfades (a cross-document view transition, where the browser supports it).
- The "service status" card is a joke departure board using real route codes (ER / RW / SB / SV).
- The sidebar ends in a punch-out ferry ticket.
- 404s say you missed the boat.
- Under `prefers-reduced-motion` the ferry still makes her crossing, just slowly (90s) and
  on a flat sea; everything else holds still.
