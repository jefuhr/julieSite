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

`projects.json` is an allowlist, not a config the page passes in: `/api/status` will
only ever fetch URLs listed there, so the endpoint can't be used as an open proxy.
Results are cached for 30s; the browser re-polls every 60s and on tab focus.

> **Note:** `/ferryTimesMobile` returns 404 until the nginx change below is live, so
> the lamp will read **down** until then. That's the health check working, not a bug.

## Deploying to the AWS box

The plan: this landing page takes `/`, and the existing ferry board moves to
`/ferryTimesMobile`.

**1. Run the landing page as a service** (`/etc/systemd/system/juliet-landing.service`):

```ini
[Unit]
Description=juliet.nyc landing page
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/juliet.nyc
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now juliet-landing
```

**2. Point nginx at both apps:**

```nginx
server {
    listen 443 ssl http2;
    server_name juliet.nyc;

    # landing page at the root
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ferry board, moved off the root
    location /ferryTimesMobile/ {
        proxy_pass http://127.0.0.1:PORT_OF_THE_BOARD/;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location = /ferryTimesMobile {
        return 301 /ferryTimesMobile/;
    }
}
```

**3. Check the board tolerates the prefix.** The trailing slash on `proxy_pass`
strips `/ferryTimesMobile` before forwarding, so the board still sees `/`. If it
serves assets with absolute paths (`/styles.css`, `/assets/…` — which it currently
does), those will 404 under the prefix. Two ways out: make the board emit relative
paths / set a base href, or give those asset roots their own `location` blocks.

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
