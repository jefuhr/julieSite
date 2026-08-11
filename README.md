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
css/style.css   all styling (colors live in :root at the top)
js/main.js      status-dot polling — progressive enhancement, page works without it
server.js       static server + /api/status
projects.json   which projects get health-checked
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

## Deploying to the AWS box

Already live. `juliet.nyc` runs two Node apps behind one nginx + certbot cert:

| Path | App | Port | Service |
|---|---|---|---|
| `/` | this landing page | 3000 | `juliet-landing.service` |
| `/ferryTimesMobile/` | ferry departure display | 8090 | `nyc-ferry-did.service` |

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
`/images/` and `/_api/status`. **If you add a route to the landing page, keep clear of
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
| In-progress branches | `index.html` → `.project` blocks |
| Colors | `css/style.css` → `:root` |

## Ferry bits

- A ferry sails the wave band under the header on a 26s loop, bobbing and smoking.
- The "service status" card is a joke departure board using real route codes (ER / RW / SB / SV).
- The sidebar ends in a punch-out ferry ticket.
- 404s say you missed the boat.
- All motion is disabled under `prefers-reduced-motion`.
