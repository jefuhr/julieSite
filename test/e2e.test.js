'use strict';

// Loads the real pages in headless Chrome and checks what the JavaScript drew.
//
//   CHROME_BIN=/usr/bin/chromium npm test
//
// Skipped when CHROME_BIN isn't set. From WSL, Windows Chrome works too:
//   CHROME_BIN="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, startServer } = require('./helpers');

const CHROME = process.env.CHROME_BIN;
const INSTALL = 'curl -fsSL https://juliet.nyc/lb/install.sh | sh';

const posts = JSON.parse(fs.readFileSync(path.join(ROOT, 'posts.json'), 'utf8')).posts;
const newestFirst = posts.slice().sort((a, b) => b.date.localeCompare(a.date));

function dumpDom(url) {
	return new Promise((resolve, reject) => {
		const proc = spawn(CHROME, [
			'--headless=new', '--disable-gpu', '--no-first-run',
			'--virtual-time-budget=5000', '--dump-dom', url,
		], { stdio: ['ignore', 'pipe', 'ignore'] });
		let out = '';
		const timer = setTimeout(() => proc.kill(), 60_000);
		proc.stdout.on('data', (chunk) => (out += chunk));
		proc.on('error', reject);
		proc.on('close', () => { clearTimeout(timer); resolve(out); });
	});
}

describe('in a real browser', { skip: !CHROME && 'set CHROME_BIN to run the browser tests' }, () => {
	let server;
	before(async () => { server = await startServer(); });
	after(() => server?.stop());

	/** The rendered DOM. Retries briefly: WSL takes a moment to forward a new port to Windows. */
	async function load(page) {
		for (let attempt = 1; ; attempt++) {
			const dom = await dumpDom(`http://localhost:${server.port}${page}`);
			if (dom.includes('<title>juliet') || attempt === 3) return dom;
			await new Promise((r) => setTimeout(r, 1000));
		}
	}

	it('landing page: the sidebar shows the three newest blog headlines', async () => {
		const dom = await load('/');
		const list = /<ol class="headlines"([^>]*)>([\s\S]*?)<\/ol>/.exec(dom);
		assert.ok(list, 'no headline list on the page');
		assert.doesNotMatch(list[1], /\bhidden\b/, 'headline list is still hidden');
		const hrefs = [...list[2].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
		assert.deepEqual(hrefs, newestFirst.slice(0, 3).map((p) => `/blog/#${p.slug}`));
		assert.doesNotMatch(dom, /data-headlines-fallback/, 'no-JS fallback should be gone');
	});

	it('landing page: live now has the lb download and its copy button', async () => {
		const dom = await load('/');
		const at = dom.indexOf('href="https://github.com/jefuhr/lb#install"');
		assert.ok(at > -1, 'no link to the lb install instructions');
		assert.ok(at > dom.indexOf('live now') && at < dom.indexOf('from the blog'), 'lb link should sit in the live now card');
		const code = /<code id="lb-install">([\s\S]*?)<\/code>/.exec(dom);
		assert.equal(code?.[1].replace(/<[^>]+>/g, ''), INSTALL, 'install one-liner missing or changed');
		const button = /<button[^>]*\bdata-copy\b[^>]*>/.exec(dom);
		assert.ok(button, 'no copy button');
		assert.doesNotMatch(button[0], /\bhidden\b/, 'copy button should be revealed once JS runs');
	});

	it('blog page: every post renders newest first, anchored by its slug', async () => {
		const dom = await load('/blog/');
		const ids = [...dom.matchAll(/<article class="post" id="([^"]+)"/g)].map((m) => m[1]);
		assert.deepEqual(ids, newestFirst.map((p) => p.slug));
		for (const post of posts) {
			assert.ok(dom.includes(`datetime="${post.date}"`), `post "${post.slug}" has no machine-readable date`);
		}
	});
});
