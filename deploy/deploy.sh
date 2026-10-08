#!/usr/bin/env bash
#
# Deploy the landing page to the juliet.nyc box.
#
#   ./deploy/deploy.sh              # sync code + restart the landing service
#   ./deploy/deploy.sh --nginx      # also reinstall the nginx site config
#
# Safe to re-run. The nginx step backs up the live config before replacing it
# and puts the backup straight back if `nginx -t` fails, so a bad config never
# gets loaded or left lying in sites-available.

set -euo pipefail

HOST="${DEPLOY_HOST:-ubuntu@52.5.187.46}"
KEY="${DEPLOY_KEY:-$HOME/julie.pem}"
APP_DIR="/opt/juliet-landing"
SERVICE="juliet-landing"

SSH=(ssh -i "$KEY" -o ConnectTimeout=15 "$HOST")
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_NGINX=0
[[ "${1:-}" == "--nginx" ]] && INSTALL_NGINX=1

if [[ "$INSTALL_NGINX" == 1 ]]; then
	echo "→ checking app DNS and certificate before changing nginx"
	"${SSH[@]}" 'set -e
		for name in ferrytimesmobile.juliet.nyc subwaysfornerds.juliet.nyc; do
			getent ahostsv4 "$name" | awk "{print \$1}" | grep -Fxq 52.5.187.46 || {
				echo "$name does not resolve to 52.5.187.46" >&2; exit 1;
			}
		done
		CERT=/etc/letsencrypt/live/ferrytimesmobile.juliet.nyc/fullchain.pem
		KEY=/etc/letsencrypt/live/ferrytimesmobile.juliet.nyc/privkey.pem
		sudo test -s "$CERT" && sudo test -s "$KEY"
		sudo openssl x509 -in "$CERT" -noout -checkhost ferrytimesmobile.juliet.nyc >/dev/null
		sudo openssl x509 -in "$CERT" -noout -checkhost subwaysfornerds.juliet.nyc >/dev/null
		curl -fsS -o /dev/null http://127.0.0.1:8090/
		curl -fsS -o /dev/null http://127.0.0.1:8090/api/landings
		curl -fsS -o /dev/null http://127.0.0.1:8091/
		curl -fsS -o /dev/null http://127.0.0.1:8091/api/v1/stations'
else
	echo "→ checking both app hosts are already live before updating their links"
	for host in ferrytimesmobile.juliet.nyc subwaysfornerds.juliet.nyc; do
		curl -fsS --max-time 15 -o /dev/null "https://$host/" || {
			echo "   https://$host/ is not serving yet; deploy the DNS, TLS, and nginx cutover first" >&2
			exit 1
		}
	done
fi

if [[ "$INSTALL_NGINX" == 1 ]]; then
	echo "→ installing nginx config"
	tar -C "$REPO_ROOT/deploy" -czf - nginx-juliet.nyc.conf juliet-proxy.conf \
		| "${SSH[@]}" "tar -C /tmp -xzf -"
	"${SSH[@]}" 'set -e
		SITE=/etc/nginx/sites-available/nyc-ferry-did
		sudo mkdir -p /etc/nginx/snippets
		sudo cp /tmp/juliet-proxy.conf /etc/nginx/snippets/juliet-proxy.conf
		STAMP=$(date +%Y%m%d-%H%M%S)
		sudo cp "$SITE" "$SITE.bak-$STAMP"
		echo "   backed up to nyc-ferry-did.bak-$STAMP"
		sudo cp /tmp/nginx-juliet.nyc.conf "$SITE"
		if ! sudo nginx -t; then
			sudo cp "$SITE.bak-$STAMP" "$SITE"
			echo "   nginx -t failed; put the previous config back (is /etc/nginx/snippets/lb.conf there?)" >&2
			exit 1
		fi
		sudo systemctl reload nginx
		echo "   nginx reloaded"'
fi

echo "→ syncing $REPO_ROOT → $HOST:$APP_DIR"
"${SSH[@]}" "sudo mkdir -p $APP_DIR && sudo chown ubuntu:ubuntu $APP_DIR"
# tar over ssh rather than rsync — rsync isn't installed on every dev box.
# server.js only serves the public files anyway; the excludes keep the rest
# (agent worktrees, tests, deploy scripts) off the box entirely.
tar -C "$REPO_ROOT" \
	--exclude='.git' \
	--exclude='.claude' \
	--exclude='node_modules' \
	--exclude='*:Zone.Identifier' \
	--exclude='deploy' \
	--exclude='test' \
	--exclude='package-lock.json' \
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

echo "→ verifying from the outside"
FAILED=0
check() {
	local label="$1" url="$2" expected="$3"
	local code
	code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)
	printf '   %-42s %s\n' "$label" "$code"
	[[ "$code" == "$expected" ]] || FAILED=1
}
check 'juliet landing page' 'https://juliet.nyc/' 200
check 'juliet blog' 'https://juliet.nyc/blog/' 200
check 'ferry subdomain' 'https://ferrytimesmobile.juliet.nyc/' 200
check 'ferry root API' 'https://ferrytimesmobile.juliet.nyc/api/landings' 200
check 'subways subdomain' 'https://subwaysfornerds.juliet.nyc/' 200
check 'subways root API' 'https://subwaysfornerds.juliet.nyc/api/v1/stations' 200
check 'lb installer' 'https://juliet.nyc/lb/install.sh' 200
check 'nycferry installer' 'https://juliet.nyc/nycferry/install.sh' 200

for redirect in \
	'https://juliet.nyc/ferryTimesMobile/route/1?from=legacy=1|https://ferrytimesmobile.juliet.nyc/route/1?from=legacy=1' \
	'https://juliet.nyc/subwaysForNerds/api/v1/stations?from=legacy=1|https://subwaysfornerds.juliet.nyc/api/v1/stations?from=legacy=1' \
	'https://juliet.nyc/subwayForNerds/route?q=1|https://subwaysfornerds.juliet.nyc/route?q=1'; do
	url="${redirect%%|*}"
	expected="${redirect#*|}"
	result=$(curl -sS -o /dev/null -w '%{http_code}|%{redirect_url}' --max-time 15 "$url" || true)
	printf '   %-42s %s\n' "legacy redirect: ${url#https://juliet.nyc}" "$result"
	[[ "$result" == "301|$expected" ]] || FAILED=1
done

[[ "$FAILED" == 0 ]] || { echo "one or more deployment checks failed" >&2; exit 1; }

echo "done."
