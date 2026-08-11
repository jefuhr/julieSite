#!/usr/bin/env bash
#
# Deploy the landing page to the juliet.nyc box.
#
#   ./deploy/deploy.sh              # sync code + restart the landing service
#   ./deploy/deploy.sh --nginx      # also reinstall the nginx site config
#
# Safe to re-run. The nginx step backs up the live config before replacing it
# and aborts on `nginx -t` failure, so a bad config never gets loaded.

set -euo pipefail

HOST="${DEPLOY_HOST:-ubuntu@52.5.187.46}"
KEY="${DEPLOY_KEY:-$HOME/julie.pem}"
APP_DIR="/opt/juliet-landing"
SERVICE="juliet-landing"

SSH=(ssh -i "$KEY" -o ConnectTimeout=15 "$HOST")
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "→ syncing $REPO_ROOT → $HOST:$APP_DIR"
"${SSH[@]}" "sudo mkdir -p $APP_DIR && sudo chown ubuntu:ubuntu $APP_DIR"
# tar over ssh rather than rsync — rsync isn't installed on every dev box
tar -C "$REPO_ROOT" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='*:Zone.Identifier' \
  --exclude='deploy' \
  -czf - . | "${SSH[@]}" "tar -C $APP_DIR -xzf -"

echo "→ installing systemd unit"
tar -C "$REPO_ROOT/deploy" -czf - juliet-landing.service | "${SSH[@]}" "tar -C /tmp -xzf -"
"${SSH[@]}" "sudo mv /tmp/juliet-landing.service /etc/systemd/system/ \
  && sudo systemctl daemon-reload \
  && sudo systemctl enable --now $SERVICE \
  && sudo systemctl restart $SERVICE"

echo "→ waiting for the service to answer on 127.0.0.1:3000"
"${SSH[@]}" 'for i in $(seq 1 10); do
    curl -fsS -o /dev/null http://127.0.0.1:3000/ && echo "   up" && exit 0
    sleep 1
  done
  echo "   landing page never came up"; sudo journalctl -u '"$SERVICE"' -n 30 --no-pager; exit 1'

if [[ "${1:-}" == "--nginx" ]]; then
  echo "→ installing nginx config"
  tar -C "$REPO_ROOT/deploy" -czf - nginx-juliet.nyc.conf juliet-proxy.conf \
    | "${SSH[@]}" "tar -C /tmp -xzf -"
  "${SSH[@]}" 'set -e
    sudo mkdir -p /etc/nginx/snippets
    sudo cp /tmp/juliet-proxy.conf /etc/nginx/snippets/juliet-proxy.conf
    STAMP=$(date +%Y%m%d-%H%M%S)
    sudo cp /etc/nginx/sites-available/nyc-ferry-did \
            /etc/nginx/sites-available/nyc-ferry-did.bak-$STAMP
    echo "   backed up to nyc-ferry-did.bak-$STAMP"
    sudo cp /tmp/nginx-juliet.nyc.conf /etc/nginx/sites-available/nyc-ferry-did
    sudo nginx -t
    sudo systemctl reload nginx
    echo "   nginx reloaded"'
fi

echo "→ verifying from the outside"
for path in / /ferryTimesMobile/ /app.js /styles.css /api/landings; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "https://juliet.nyc${path}")
  printf '   %-22s %s\n' "$path" "$code"
done

echo "done."
