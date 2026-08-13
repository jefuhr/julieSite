#!/usr/bin/env bash
#
# Deploy the juliet.nyc landing page.
#
#   ./deploy/deploy.sh                 # test, back up, sync, restart, verify
#   ./deploy/deploy.sh --skip-tests    # skip the local smoke test
#   ./deploy/deploy.sh --branch fixes  # deploy a different branch
#   ./deploy/deploy.sh --dry-run       # show what would change, touch nothing
#   ./deploy/deploy.sh --nginx         # also reinstall the nginx site config
#
# Deploys from `git archive <branch>`, i.e. committed code only — uncommitted
# work in the checkout is never shipped by accident.
#
# The box shares juliet.nyc with the ferry board (nyc-ferry-did.service, which
# owns /app.js, /styles.css, /assets/* and /api/*). Nothing here touches that
# service, and the verify step curls it too, so a bad deploy of this page can't
# quietly take the board down with it.
#
# The systemd unit is only reinstalled when it actually changed. The nginx step
# backs up the live config first and aborts on `nginx -t`, so a bad config
# never gets loaded.

set -euo pipefail

REPO="${JULIET_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${JULIET_BRANCH:-main}"
HOST="${DEPLOY_HOST:-ubuntu@52.5.187.46}"
KEY="${DEPLOY_KEY:-$HOME/julie.pem}"
APP_DIR="/opt/juliet-landing"
SERVICE="juliet-landing"
UNIT="juliet-landing.service"
APP_PORT=3000
SITE="https://juliet.nyc"
KEEP_BACKUPS=5

SKIP_TESTS=0
DRY_RUN=0
DO_NGINX=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests) SKIP_TESTS=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --nginx)      DO_NGINX=1; shift ;;
    --branch)     BRANCH="$2"; shift 2 ;;
    -h|--help)    sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST")
say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[[ -d "$REPO/.git" || -f "$REPO/.git" ]] || die "no git repo at $REPO"
git -C "$REPO" rev-parse --verify --quiet "$BRANCH" >/dev/null || die "no branch '$BRANCH' in $REPO"
[[ -r "$KEY" ]] || die "no ssh key at $KEY (set DEPLOY_KEY)"
"${SSH[@]}" true 2>/dev/null || die "cannot ssh to $HOST with $KEY (set DEPLOY_HOST / DEPLOY_KEY)"

LOCAL_SHA=$(git -C "$REPO" rev-parse "$BRANCH")
DEPLOYED_SHA=$("${SSH[@]}" "cat $APP_DIR/DEPLOYED_SHA 2>/dev/null" || true)

# A sha the box knows and this repo doesn't (rebased branch, fresh clone) can't be
# diffed against — say so and deploy as if this were the first time.
if [[ -n "$DEPLOYED_SHA" ]] && ! git -C "$REPO" cat-file -e "${DEPLOYED_SHA}^{commit}" 2>/dev/null; then
  printf '  \033[1;33m! the live commit %s is not in this repo — fetch, or expect no diff\033[0m\n' "${DEPLOYED_SHA:0:7}"
  DEPLOYED_SHA=""
fi

FIRST_RUN=0
"${SSH[@]}" "test -d $APP_DIR" || FIRST_RUN=1

say "deploying ${BRANCH} → ${HOST}"
if [[ "$FIRST_RUN" == 1 ]]; then echo "  first run — $APP_DIR does not exist on the box yet"; fi
echo "  local:    ${LOCAL_SHA:0:7}  $(git -C "$REPO" log -1 --format=%s "$BRANCH")"
if [[ -n "$DEPLOYED_SHA" ]]; then
  echo "  deployed: ${DEPLOYED_SHA:0:7}"
  if [[ "$DEPLOYED_SHA" == "$LOCAL_SHA" ]]; then
    echo "  already up to date — nothing to do."; exit 0
  fi
  echo
  git -C "$REPO" log --oneline "${DEPLOYED_SHA}..${BRANCH}" | sed 's/^/    /'
  echo
  git -C "$REPO" diff --stat "${DEPLOYED_SHA}..${BRANCH}" | sed 's/^/    /'
else
  echo "  deployed: unknown (no DEPLOYED_SHA on the box)"
fi

# --- warn about work that is not going out ------------------------------------
DIRTY=$(git -C "$REPO" status --porcelain)
if [[ -n "$DIRTY" ]]; then
  printf '\n  \033[1;33m! uncommitted work in %s — this is NOT deployed:\033[0m\n' "$REPO"
  echo "$DIRTY" | head -10 | sed 's/^/    /'
  EXTRA=$(( $(wc -l <<<"$DIRTY") - 10 ))
  if [[ $EXTRA -gt 0 ]]; then echo "    … $EXTRA more"; fi
fi

# --- the sidebar has two halves; make sure they agree -------------------------
# index.html links each live project by data-project id; projects.json is the
# allowlist the server is willing to probe. An id in one and not the other is a
# dead status lamp (or a link that never lights up).
say "checking sidebar ↔ projects.json"
HTML=$(git -C "$REPO" show "${BRANCH}:index.html")
JSON=$(git -C "$REPO" show "${BRANCH}:projects.json")
python3 -c "
import json, re, sys
html, raw = sys.argv[1], sys.argv[2]
page = set(re.findall(r'data-project=\"([^\"]+)\"', html))
cfg  = {p['id'] for p in json.loads(raw).get('projects', [])}
for missing, where in ((page - cfg, 'projects.json'), (cfg - page, 'index.html')):
    for i in sorted(missing):
        print(f'  ! {i!r} is missing from {where}')
if page == cfg:
    print(f'  {len(page)} project(s), both halves agree')
" "$HTML" "$JSON"

if [[ "$DRY_RUN" == 1 ]]; then say "dry run — stopping before any changes"; exit 0; fi

# --- smoke test the exact tree we are about to ship ---------------------------
if [[ "$SKIP_TESTS" == 1 ]]; then
  say "skipping smoke test (--skip-tests)"
else
  say "smoke testing ${BRANCH} locally"
  TESTDIR=$(mktemp -d)
  TESTPID=""
  cleanup() { [[ -n "$TESTPID" ]] && kill "$TESTPID" 2>/dev/null || true; rm -rf "$TESTDIR"; }
  trap cleanup EXIT

  git -C "$REPO" archive "$BRANCH" | tar -x -C "$TESTDIR" -f -
  node --check "$TESTDIR/server.js" || die "server.js does not parse"

  TESTPORT=$((20000 + RANDOM % 10000))
  # exec so $! is node itself — killing the subshell would leave it holding the port
  ( cd "$TESTDIR" && exec env HOST=127.0.0.1 PORT=$TESTPORT node server.js >"$TESTDIR/.log" 2>&1 ) &
  TESTPID=$!
  for _ in $(seq 1 20); do
    curl -fs -o /dev/null "http://127.0.0.1:${TESTPORT}/" && break
    sleep 0.5
  done

  FAILED=0
  check() { # path expected-code
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${TESTPORT}$1" || echo 000)
    printf '  %-22s %s\n' "$1" "$code"
    [[ "$code" == "$2" ]] || FAILED=1
  }
  check /                  200
  check /css/style.css     200
  check /js/main.js        200
  check /images/favicon.png 200
  check /_api/status       200
  check /no-such-page      404
  if [[ "$FAILED" == 1 ]]; then
    sed 's/^/    /' "$TESTDIR/.log"
    die "local smoke test failed — not deploying"
  fi
  cleanup; trap - EXIT
fi

# --- backup -------------------------------------------------------------------
if [[ "$FIRST_RUN" == 1 ]]; then
  say "creating $APP_DIR (nothing to back up)"
  "${SSH[@]}" "sudo mkdir -p $APP_DIR && sudo chown \$(id -un):\$(id -gn) $APP_DIR && echo '  created'"
  ROLLBACK="no backup — $APP_DIR did not exist before this run"
else
  STAMP=$(date +%Y%m%d-%H%M%S)
  BACKUP="/opt/${SERVICE}-backup-${STAMP}.tgz"
  ROLLBACK="ssh -i $KEY $HOST 'cd /opt && sudo tar xzf $BACKUP && sudo systemctl restart $SERVICE'"
  say "backing up to $BACKUP"
  "${SSH[@]}" "cd /opt && sudo tar --exclude=${SERVICE}/node_modules -czf $BACKUP ${SERVICE} && ls -lh $BACKUP | awk '{print \"  \" \$5}'"
fi

# --- sync ---------------------------------------------------------------------
say "syncing committed files from ${BRANCH}"
git -C "$REPO" archive "$BRANCH" \
  | "${SSH[@]}" "cd $APP_DIR && tar -x -f - && echo '  extracted'"

# tar only ever adds; drop the files this branch deleted since the last deploy
# so a removed photo or stylesheet doesn't linger on the box forever.
if [[ -n "$DEPLOYED_SHA" ]]; then
  GONE=$(git -C "$REPO" diff --diff-filter=D --name-only "${DEPLOYED_SHA}..${BRANCH}" || true)
  if [[ -n "$GONE" ]]; then
    echo "$GONE" | sed 's/^/  - /'
    printf '%s\n' "$GONE" | "${SSH[@]}" "cd $APP_DIR && xargs -r -d '\n' rm -f --"
  fi
fi

echo "$LOCAL_SHA" | "${SSH[@]}" "cat > /tmp/juliet-sha && cp /tmp/juliet-sha $APP_DIR/DEPLOYED_SHA"

# --- dependencies -------------------------------------------------------------
# The page has none today. If that ever changes, ship them rather than leaving
# the box with a stale (or empty) node_modules.
if git -C "$REPO" cat-file -e "${BRANCH}:package-lock.json" 2>/dev/null; then
  if [[ -z "$DEPLOYED_SHA" ]] || \
     ! git -C "$REPO" diff --quiet "${DEPLOYED_SHA}..${BRANCH}" -- package.json package-lock.json 2>/dev/null; then
    say "dependencies changed — running npm ci"
    "${SSH[@]}" "cd $APP_DIR && npm ci --omit=dev 2>&1 | tail -3"
  fi
fi

# --- systemd unit -------------------------------------------------------------
LOCAL_UNIT=$(git -C "$REPO" show "${BRANCH}:deploy/${UNIT}" | sha256sum | cut -d' ' -f1)
BOX_UNIT=$("${SSH[@]}" "sha256sum /etc/systemd/system/${UNIT} 2>/dev/null | cut -d' ' -f1" || true)
if [[ "$LOCAL_UNIT" != "$BOX_UNIT" ]]; then
  say "installing systemd unit (changed)"
  git -C "$REPO" show "${BRANCH}:deploy/${UNIT}" | "${SSH[@]}" "cat > /tmp/${UNIT}"
  "${SSH[@]}" "sudo mv /tmp/${UNIT} /etc/systemd/system/${UNIT} \
    && sudo systemctl daemon-reload \
    && sudo systemctl enable $SERVICE >/dev/null \
    && echo '  installed'"
fi

# --- nginx ---------------------------------------------------------------------
if [[ "$DO_NGINX" == 1 ]]; then
  say "installing nginx config"
  tar -C "$REPO/deploy" -czf - nginx-juliet.nyc.conf juliet-proxy.conf | "${SSH[@]}" "tar -C /tmp -xzf -"
  "${SSH[@]}" 'set -e
    sudo mkdir -p /etc/nginx/snippets
    sudo cp /tmp/juliet-proxy.conf /etc/nginx/snippets/juliet-proxy.conf
    STAMP=$(date +%Y%m%d-%H%M%S)
    sudo cp /etc/nginx/sites-available/nyc-ferry-did \
            /etc/nginx/sites-available/nyc-ferry-did.bak-$STAMP
    echo "  backed up to nyc-ferry-did.bak-$STAMP"
    sudo cp /tmp/nginx-juliet.nyc.conf /etc/nginx/sites-available/nyc-ferry-did
    sudo nginx -t
    sudo systemctl reload nginx
    echo "  nginx reloaded"'
fi

# --- restart ------------------------------------------------------------------
say "restarting $SERVICE"
"${SSH[@]}" "sudo systemctl restart $SERVICE"
sleep 2
STATE=$("${SSH[@]}" "systemctl is-active $SERVICE" || true)
if [[ "$STATE" != "active" ]]; then
  "${SSH[@]}" "sudo journalctl -u $SERVICE -n 30 --no-pager"
  die "service is '$STATE' — restore with: $ROLLBACK"
fi
"${SSH[@]}" "for i in \$(seq 1 10); do
    curl -fsS -o /dev/null http://127.0.0.1:${APP_PORT}/ && echo '  answering on 127.0.0.1:${APP_PORT}' && exit 0
    sleep 1
  done
  echo '  never came up'; sudo journalctl -u $SERVICE -n 30 --no-pager; exit 1" \
  || die "the landing page is not answering locally — restore with: $ROLLBACK"

# --- verify -------------------------------------------------------------------
# The landing page's own paths, then the ferry board's — the two apps share this
# domain, so proving the board still answers is part of proving this deploy.
say "verifying from the outside"
FAILED=0
for path in / /css/style.css /js/main.js /images/favicon.png /_api/status \
            /ferryTimesMobile/ /app.js /styles.css /api/landings; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${SITE}${path}" || echo 000)
  printf '  %-22s %s\n' "$path" "$code"
  [[ "$code" == "200" ]] || FAILED=1
done
printf '  %-22s %s\n' "status lamps" \
  "$(curl -sS --max-time 15 "${SITE}/_api/status" | python3 -c \
     "import json,sys; d=json.load(sys.stdin); print(', '.join(f\"{p['id']}={'up' if p.get('up') else 'down'}\" for p in d['projects']) or 'none')" \
     2>/dev/null || echo '?')"

if [[ "$FAILED" == 1 ]]; then
  die "something is not answering 200 — restore with: $ROLLBACK"
fi

# --- prune old backups --------------------------------------------------------
"${SSH[@]}" "ls -1t /opt/${SERVICE}-backup-*.tgz 2>/dev/null | tail -n +$((KEEP_BACKUPS+1)) | xargs -r sudo rm -f"

say "done — ${BRANCH} @ ${LOCAL_SHA:0:7} is live at ${SITE}"
echo "  rollback: $ROLLBACK"
