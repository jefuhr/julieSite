# julieSite

A personal page. Hello Kitty pink, with NYC Ferry running through it.

Static HTML/CSS — no build step, no dependencies, no external requests (icons are inline SVG).
Open `index.html` in a browser, or serve it:

```bash
python3 -m http.server 8000 --bind 127.0.0.1   # then visit http://localhost:8000
```

`--bind 127.0.0.1` keeps it on localhost only. Without it, `http.server` binds `0.0.0.0`
and anyone on your network (or your WSL host) can reach the page.

## Where to edit things

| What | Where |
|---|---|
| Name, tagline, intro paragraph | `index.html` → `.masthead` and `#about` |
| Social links | `index.html` → `.socials` (Instagram + LinkedIn still say `YOUR_HANDLE`) |
| Your photos | drop files in `images/` — see `images/README.md` |
| Current projects / branches | `index.html` → `<aside class="sidebar">` |
| Colors | `css/style.css` → the `:root` block at the top |

## Ferry bits

- A ferry sails across the wave band under the header on a 26s loop.
- The "service status" card is a joke departure board — routes ER / RW / SB / SV, real NYC Ferry route codes.
- The sidebar ends in a punch-out ferry ticket.
- All animation is disabled under `prefers-reduced-motion`.

## Publishing

Repo Settings → Pages → deploy from `main` / root. It'll land at
`https://jefuhr.github.io/julieSite/`.
