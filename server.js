'use strict';

/**
 * juliet.nyc landing page
 *
 * Zero-dependency Node static server. Serves the page and one small JSON
 * endpoint (/_api/status) that reports whether each live project is reachable.
 *
 *   node server.js                       # http://127.0.0.1:8000
 *   PORT=3000 HOST=0.0.0.0 node server.js
 *
 * Behind nginx/ALB on the real box, bind localhost and let the proxy face
 * the internet: HOST=127.0.0.1 PORT=3000 node server.js
 */

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8000); // PORT=0 picks a free port
const HOST = process.env.HOST || '127.0.0.1';

const STATUS_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;

/**
 * The only files the world gets to see. Everything else in the repo — the
 * server, the README, deploy scripts, dotfiles, anything a deploy happens to
 * sweep up — 404s, whether or not it exists.
 */
const PUBLIC_FILES = new Set(['index.html', 'posts.json']);
const PUBLIC_DIRS = new Set(['blog', 'css', 'js', 'images']);

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
};

/** Things that change with every deploy or every post: always ask before reusing. */
const REVALIDATE = new Set(['.html', '.css', '.js', '.json']);

/* ---------------------------------------------------------------- projects */

function loadProjects() {
	try {
		const raw = fs.readFileSync(path.join(ROOT, 'projects.json'), 'utf8');
		return JSON.parse(raw).projects ?? [];
	} catch (err) {
		console.warn(`[warn] could not read projects.json (${err.message}) — /_api/status will be empty`);
		return [];
	}
}

const PROJECTS = loadProjects();

/* ----------------------------------------------------------------- probing */

/** GET a single allow-listed URL and report whether it answered. Never throws. */
function probe(url) {
	return new Promise((resolve) => {
		let target;
		try {
			target = new URL(url);
		} catch {
			return resolve({ up: false, error: 'bad url' });
		}
		if (target.protocol !== 'http:' && target.protocol !== 'https:') {
			return resolve({ up: false, error: 'unsupported protocol' });
		}

		const started = Date.now();
		const client = target.protocol === 'https:' ? https : http;
		const req = client.request(
			target,
			{ method: 'GET', timeout: PROBE_TIMEOUT_MS, headers: { 'user-agent': 'juliet.nyc-landing/1.0' } },
			(res) => {
				res.resume(); // drain, we only care about the status line
				resolve({ up: res.statusCode < 400, code: res.statusCode, ms: Date.now() - started });
			}
		);
		req.on('timeout', () => { req.destroy(); resolve({ up: false, error: 'timeout' }); });
		req.on('error', (err) => resolve({ up: false, error: err.code || err.message }));
		req.end();
	});
}

let statusCache = { at: 0, body: null };

async function getStatus() {
	if (statusCache.body && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.body;

	const results = await Promise.all(
		PROJECTS.map(async (p) => ({ id: p.id, name: p.name, ...(await probe(p.probe || p.url)) }))
	);

	statusCache = { at: Date.now(), body: { checkedAt: new Date().toISOString(), projects: results } };
	return statusCache.body;
}

/* ---------------------------------------------------------------- responses */

const TEXT = 'text/plain; charset=utf-8';
const HTML = 'text/html; charset=utf-8';

function send(res, code, body, headers = {}) {
	res.writeHead(code, { 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', ...headers });
	res.end(body);
}

/** Whether a repo-relative path (already decoded and resolved) is part of the public site. */
function isPublic(rel) {
	const parts = rel.split(path.sep);
	if (parts.some((part) => part.startsWith('.'))) return false;
	return rel === '' || PUBLIC_FILES.has(rel) || PUBLIC_DIRS.has(parts[0]);
}

async function serveStatic(req, res, url) {
	let decoded;
	try {
		decoded = decodeURIComponent(url.pathname);
	} catch {
		return send(res, 400, 'Bad Request', { 'content-type': TEXT });
	}

	const filePath = path.resolve(ROOT, decoded.replace(/^\/+/, ''));
	const rel = path.relative(ROOT, filePath);
	if (rel.startsWith('..') || path.isAbsolute(rel) || !isPublic(rel)) {
		return send(res, 404, notFoundPage(), { 'content-type': HTML });
	}

	let finalPath = filePath;
	let stat = await fsp.stat(finalPath).catch(() => null);
	if (stat?.isDirectory()) {
		// /blog → /blog/, so the page's relative links resolve against the right folder.
		// Built from the resolved path: echoing "//blog" back would point at a host.
		if (!url.pathname.endsWith('/')) {
			const canonical = rel.split(path.sep).map(encodeURIComponent).join('/');
			return send(res, 301, '', { location: `/${canonical}/${url.search}` });
		}
		finalPath = path.join(filePath, 'index.html');
		stat = await fsp.stat(finalPath).catch(() => null);
	}
	const ext = path.extname(finalPath).toLowerCase();
	// only web assets; notes like images/README.md stay in the repo
	if (!stat?.isFile() || !MIME[ext]) return send(res, 404, notFoundPage(), { 'content-type': HTML });

	const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
	const headers = {
		etag,
		'cache-control': REVALIDATE.has(ext) ? 'no-cache' : 'public, max-age=3600',
	};

	const cached = req.headers['if-none-match']?.split(/\s*,\s*/) ?? [];
	if (cached.includes(etag)) return send(res, 304, undefined, headers);

	let data;
	try {
		data = await fsp.readFile(finalPath);
	} catch {
		return send(res, 404, notFoundPage(), { 'content-type': HTML });
	}
	send(res, 200, data, { ...headers, 'content-type': MIME[ext] });
}

function notFoundPage() {
	return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 · missed the boat</title><link rel="icon" type="image/png" href="/images/favicon.png?v=2">
<style>body{font-family:ui-rounded,"SF Pro Rounded","Arial Rounded MT Bold","Trebuchet MS",system-ui,sans-serif;
background:#ffe3ec;color:#3b2b33;display:grid;place-items:center;min-height:100dvh;margin:0;padding:24px;
box-sizing:border-box;text-align:center}a{color:#d8365a;font-weight:700}h1{font-size:3rem;margin:.2em}
@media (prefers-color-scheme:dark){body{background:#1b1030;color:#fbe9f1}a{color:#ff8fb3}}</style>
<div><h1>404 🎀</h1><p>You just missed the boat. Next departure: <a href="/">the landing</a>.</p></div>`;
}

/* ------------------------------------------------------------------ server */

/** The request target as a URL, or null if it's too broken to parse. */
function parseTarget(target) {
	try {
		// origin-form ("/path?q") is what browsers send; absolute-form only via proxies
		return target.startsWith('/') ? new URL(`http://localhost${target}`) : new URL(target);
	} catch {
		return null;
	}
}

async function handle(req, res) {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		return send(res, 405, 'Method Not Allowed', { allow: 'GET, HEAD', 'content-type': TEXT });
	}

	const url = parseTarget(req.url);
	if (!url) return send(res, 400, 'Bad Request', { 'content-type': TEXT });

	// NOTE: deliberately /_api/, not /api/ — the ferry board owns /api/* at the
	// root of juliet.nyc (landings, alerts, realtime), so this must not collide.
	if (url.pathname === '/_api/status') {
		const body = JSON.stringify(await getStatus());
		return send(res, 200, body, { 'content-type': 'application/json; charset=utf-8' });
	}

	return serveStatic(req, res, url);
}

const server = http.createServer((req, res) => {
	// one bad request must never take the whole site down with it
	handle(req, res).catch((err) => {
		console.error(`[error] ${req.method} ${req.url}: ${err.stack || err}`);
		if (!res.headersSent) send(res, 500, 'Internal Server Error', { 'content-type': TEXT });
		else res.destroy();
	});
});

server.listen(PORT, HOST, () => {
	const { port } = server.address();
	console.log(`🎀  juliet.nyc landing → http://${HOST}:${port}`);
	console.log(`⚓  tracking ${PROJECTS.length} project(s): ${PROJECTS.map((p) => p.id).join(', ') || 'none'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => {
		console.log('\n⚓  all ashore. shutting down.');
		server.close(() => process.exit(0));
	});
}
