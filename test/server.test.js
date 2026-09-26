'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, request } = require('./helpers');

let server;
before(async () => { server = await startServer(); });
after(() => server.stop());

describe('static files', () => {
	it('serves the landing page, revalidated by ETag', async () => {
		const res = await request(server.port, '/');
		assert.equal(res.status, 200);
		assert.match(res.headers['content-type'], /^text\/html/);
		assert.equal(res.headers['cache-control'], 'no-cache');
		assert.ok(res.headers.etag, 'expected an ETag');
	});

	it('answers a matching If-None-Match with an empty 304', async () => {
		const first = await request(server.port, '/css/style.css');
		const again = await request(server.port, '/css/style.css', {
			headers: { 'if-none-match': first.headers.etag },
		});
		assert.equal(again.status, 304);
		assert.equal(again.body, '');
	});

	it('serves posts.json without letting browsers sit on a stale copy', async () => {
		const res = await request(server.port, '/posts.json');
		assert.equal(res.status, 200);
		assert.match(res.headers['content-type'], /^application\/json/);
		assert.equal(res.headers['cache-control'], 'no-cache');
		assert.doesNotThrow(() => JSON.parse(res.body));
	});

	it('lets browsers cache images', async () => {
		const res = await request(server.port, '/images/favicon.png');
		assert.equal(res.status, 200);
		assert.equal(res.headers['content-type'], 'image/png');
		assert.match(res.headers['cache-control'], /max-age=\d+/);
	});

	it('serves the blog at /blog/ and redirects /blog there', async () => {
		const page = await request(server.port, '/blog/');
		assert.equal(page.status, 200);
		assert.match(page.body, /ship log/);

		const bare = await request(server.port, '/blog');
		assert.equal(bare.status, 301);
		assert.equal(bare.headers.location, '/blog/');
	});

	it('never redirects off-site, even for //folder', async () => {
		// "//blog/" in a Location header would mean the host "blog"
		const res = await request(server.port, '//blog?x=1');
		assert.equal(res.status, 301);
		assert.equal(res.headers.location, '/blog/?x=1');
	});

	it('answers HEAD with headers and no body', async () => {
		const res = await request(server.port, '/', { method: 'HEAD' });
		assert.equal(res.status, 200);
		assert.equal(res.body, '');
	});

	it('refuses other methods', async () => {
		const res = await request(server.port, '/', { method: 'POST' });
		assert.equal(res.status, 405);
		assert.equal(res.headers.allow, 'GET, HEAD');
	});

	it('sends the 404 page for a missing file', async () => {
		const res = await request(server.port, '/images/nope.png');
		assert.equal(res.status, 404);
		assert.match(res.body, /missed the boat/);
	});
});

describe('only the public site is served', () => {
	const privatePaths = [
		'/README.md',
		'/server.js',
		'/package.json',
		'/projects.json',
		'/.gitignore',
		'/.claude/',
		'/deploy/deploy.sh',
		'/images/README.md',
		'/test/helpers.js',
		'/images/../server.js',
		'/css/..%2fserver.js',
		'/css/%2e%2e/README.md',
	];

	for (const target of privatePaths) {
		it(`404s ${target}`, async () => {
			const res = await request(server.port, target);
			assert.equal(res.status, 404);
		});
	}
});

describe('malformed requests', () => {
	for (const target of ['/%E0%A4%A', '/%', '/blog/%zz']) {
		it(`answers ${target} with 400 and stays up`, async () => {
			const res = await request(server.port, target);
			assert.equal(res.status, 400);
			assert.ok(server.alive(), `server died:\n${server.log()}`);
			assert.equal((await request(server.port, '/')).status, 200);
		});
	}

	it('survives a request target of //', async () => {
		const res = await request(server.port, '//');
		assert.ok(res.status < 500, `got ${res.status}`);
		assert.ok(server.alive(), `server died:\n${server.log()}`);
	});

	it('survives a garbage Host header', async () => {
		const res = await request(server.port, '/', { headers: { host: '[' } });
		assert.equal(res.status, 200);
		assert.ok(server.alive(), `server died:\n${server.log()}`);
	});
});
