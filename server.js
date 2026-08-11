'use strict';

/**
 * juliet.nyc landing page
 *
 * Zero-dependency Node static server. Serves the page and one small JSON
 * endpoint (/api/status) that reports whether each live project is reachable.
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
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '127.0.0.1';

const STATUS_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;

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
  '.md': 'text/plain; charset=utf-8',
};

/* ---------------------------------------------------------------- projects */

function loadProjects() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'projects.json'), 'utf8');
    return JSON.parse(raw).projects ?? [];
  } catch (err) {
    console.warn(`[warn] could not read projects.json (${err.message}) — /api/status will be empty`);
    return [];
  }
}

const PROJECTS = loadProjects();

/* ----------------------------------------------------------------- probing */

/** HEAD (falling back to GET) a single allow-listed URL. Never throws. */
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

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'cache-control': 'no-cache', ...headers });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, rel === '' ? 'index.html' : rel);

  // never escape the site root
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden', { 'content-type': 'text/plain; charset=utf-8' });
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return send(res, 404, await notFoundPage(), { 'content-type': 'text/html; charset=utf-8' });
  }

  const finalPath = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
  const ext = path.extname(finalPath).toLowerCase();

  try {
    const data = await fsp.readFile(finalPath);
    send(res, 200, data, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
  } catch {
    send(res, 404, await notFoundPage(), { 'content-type': 'text/html; charset=utf-8' });
  }
}

async function notFoundPage() {
  return `<!doctype html><meta charset="utf-8"><title>404 · missed the boat</title>
<style>body{font-family:"Trebuchet MS",sans-serif;background:#ffe3ec;color:#3b2b33;
display:grid;place-items:center;height:100vh;margin:0;text-align:center}
a{color:#e8455f}h1{font-size:3rem;margin:.2em}</style>
<div><h1>404 🎀</h1><p>You just missed the boat. Next departure: <a href="/">the landing</a>.</p></div>`;
}

/* ------------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed', { allow: 'GET, HEAD', 'content-type': 'text/plain' });
  }

  // NOTE: deliberately /_api/, not /api/ — the ferry board owns /api/* at the
  // root of juliet.nyc (landings, alerts, realtime), so this must not collide.
  if (pathname === '/_api/status') {
    try {
      const body = JSON.stringify(await getStatus());
      return send(res, 200, body, { 'content-type': 'application/json; charset=utf-8' });
    } catch (err) {
      return send(res, 500, JSON.stringify({ error: err.message }), {
        'content-type': 'application/json; charset=utf-8',
      });
    }
  }

  return serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`🎀  juliet.nyc landing → http://${HOST}:${PORT}`);
  console.log(`⚓  tracking ${PROJECTS.length} project(s): ${PROJECTS.map((p) => p.id).join(', ') || 'none'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n⚓  all ashore. shutting down.');
    server.close(() => process.exit(0));
  });
}
