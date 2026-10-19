# juliet.nyc

Landing page for **juliet.nyc**. Hello Kitty pink, with NYC Ferry running through it.

Node.js, zero dependencies. The page itself is plain HTML/CSS with inline SVG icons —
no CDN, no build step, no `npm install`.

```bash
npm start                      # http://127.0.0.1:8000
npm run dev                    # same, with --watch reload
PORT=3000 node server.js       # pick a port
```

`server.js` binds `127.0.0.1` by default. Set `HOST=0.0.0.0` only if you want it
facing the network directly instead of sitting behind nginx.

## What's here

```
index.html      the page
blog/index.html the blog ("ship log")
css/style.css   all styling (colors live in :root at the top)
js/main.js      status-dot polling — progressive enhancement, page works without it
js/posts.js     renders blog headlines (landing) and full posts (/blog)
server.js       static server + /api/status
projects.json   which projects get health-checked
posts.json      the blog posts themselves
images/         your photos go here (see images/README.md)
```

## The "live now" sidebar

The left sidebar links to things actually running on the box. Each link has a status
lamp that goes green when the project answers, red when it doesn't.

To add a project, do both halves:

1. **`index.html`** — copy the `<li>` inside `.live-list`, set the `href`, the display
   name, and a unique `data-project` id.
2. **`projects.json`** — add an entry with that same `id` plus a `probe` URL.

`projects.json` is an allowlist, not a config the page passes in: `/_api/status` will
only ever fetch URLs listed there, so the endpoint can't be used as an open proxy.
Results are cached for 30s; the browser re-polls every 60s and on tab focus.

## The blog

`/blog/` is the blog. Every post lives in **`posts.json`** — that file is the only
place a post is written down, and both the blog page and the "from the blog" card in
the landing page sidebar render from it. Add an entry and it shows up in both.

```json
{
  "slug": "hello-harbor",        // anchor: /blog/#hello-harbor
  "title": "Hello, harbor",
  "date": "2026-08-10",          // YYYY-MM-DD; posts sort newest first
  "tag": "ship log",             // optional pill next to the date
  "summary": "One line, shown under the headline on the landing page.",
  "body": ["First paragraph.", "Second paragraph."]
}
```

`body` is a list of paragraphs of plain text — no markdown, no HTML, no build step.
The sidebar card shows the three newest headlines and links each one to its anchor on
the blog page; change `HEADLINE_COUNT` in `js/posts.js` for a different number.

Rendering happens in the browser, so with JavaScript off the blog page points at
`posts.json` and the sidebar card falls back to a plain link to `/blog/`.

## Deploying to the AWS box

This checkout describes the landing page and Ferry Kitty routes. Production also
hosts other applications behind nginx; preserve their configuration when deploying.

| Path | App | Port | Service |
|---|---|---|---|
| `/` and `/blog/` | this landing page | 3000 | `juliet-landing.service` |
| `https://ferrykitty.juliet.nyc/` | Ferry Kitty canonical host | 8090 | `nyc-ferry-did.service` |
| `/ferryTimesMobile/` | Ferry Kitty legacy entry point | 8090 | `nyc-ferry-did.service` |

### Ferry Kitty domain setup

The landing page, blog, and health probe use `https://ferrykitty.juliet.nyc/`.
The domain was enabled on October 18, 2026 with its own automatically renewed TLS
certificate. The old hostname remains available. To recreate the setup:

1. Add an `A` record for `ferrykitty.juliet.nyc` pointing to `52.5.187.46`.
2. Install `deploy/nginx-ferrykitty.conf` as a **new** enabled nginx site at
   `/etc/nginx/sites-available/ferrykitty.juliet.nyc`. Run `sudo nginx -t` before
   reloading nginx. The new site forwards every path to the existing app on port 8090.
3. After public DNS resolves, run
   `sudo certbot --nginx -d ferrykitty.juliet.nyc --redirect` to issue its own
   certificate and enable HTTPS. Preserve Certbot's changes on subsequent deploys.
4. Verify the new HTTPS homepage, `/api/landings`, `/sw.js`, and the assets
   referenced by the homepage before publishing the landing-page changes.

The existing production hostname is `ferrytimesmobile.juliet.nyc` (plural).
Keep it and `/ferryTimesMobile/` available for existing links and installed web apps.
Browser preferences and offline caches are isolated by origin: they remain on the
old hostname and do not automatically appear on the new one. Native app IDs,
service names, data directories, and the existing blog post anchor stay unchanged.

Production has additional sites and landing-page entries absent from this checkout.
Apply this rename to the current production files without replacing those additions.
Do not use `./deploy/deploy.sh --nginx` for this domain change: its shared-site
template predates the production subdomains and other application routes.
The separate Ferry Kitty site avoids overwriting them or the existing shared
certificate used by the old ferry hostname and Subways for Nerds.

### General landing-page deployment

To ship a change:

```bash
./deploy/deploy.sh            # sync code + restart the landing service
./deploy/deploy.sh --nginx    # also reinstall the nginx site config
```

The script tars the repo to `/opt/juliet-landing`, installs the systemd unit, waits
for the service to answer, and curls both apps from the outside to prove nothing
broke. The `--nginx` path backs up the live config first and aborts on `nginx -t`
failure, so a bad config can't get loaded. Host and key come from `DEPLOY_HOST` /
`DEPLOY_KEY` (defaults: `ubuntu@52.5.187.46`, `~/julie.pem`).

### Why the routing looks the way it does

The board was written to sit at a domain root: its HTML asks for `/app.js`,
`/styles.css`, `/assets/…` and it fetches `/api/landings`, `/api/alerts`,
`/api/realtime`, `/api/display-data`, `/api/override`. Moving it to a subpath would
have broken every one of those.

Rather than patch the board, `deploy/nginx-juliet.nyc.conf` routes those root paths
back to it, and the landing page stays out of their way — it uses `/css/`, `/js/`,
`/images/`, `/blog/`, `/posts.json` and `/_api/status`. **If you add a route to the landing page, keep clear of
the board's paths above**, or the board will break.

Rollback: the nginx configs are backed up on the box as
`/etc/nginx/sites-available/nyc-ferry-did.bak-<timestamp>`.


## Where to edit things

| What | Where |
|---|---|
| Name, tagline, intro | `index.html` → `.masthead` and `#about` |
| Social links | `index.html` → `.socials` (Instagram + LinkedIn still say `YOUR_HANDLE`) |
| Photos | drop files in `images/` — see `images/README.md` |
| Live project links | `index.html` → `.live-list` **and** `projects.json` |
| Blog posts | `posts.json` |
| Colors | `css/style.css` → `:root` |

## Ferry bits

- A ferry sails the wave band under the header on a 26s loop, bobbing and smoking.
- The "service status" card is a joke departure board using real route codes (ER / RW / SB / SV).
- The sidebar ends in a punch-out ferry ticket.
- 404s say you missed the boat.
- All motion is disabled under `prefers-reduced-motion`.
