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
const NYCFERRY_INSTALL = 'curl -fsSL https://juliet.nyc/nycferry/install.sh | sh';

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

	it('landing page: ko-fi support sits above the blog and replaces the service and promo cards', async () => {
		const dom = await load('/');
		const support = /<section[^>]*id="donate"[\s\S]*?<\/section>/.exec(dom);
		assert.ok(support, 'no donation card');
		assert.ok(dom.indexOf('id="donate"') < dom.indexOf('data-headlines'), 'donation card should precede the blog');
		assert.match(support[0], /href="https:\/\/ko-fi\.com\/julietnyc"/);
		assert.match(support[0], /buy me a coffee/);
		assert.doesNotMatch(dom, /id="service"|PROMOCODE|penguin2026/);
		assert.match(dom, /href="https:\/\/github\.com\/jefuhr\/nycferry#install"/);
	});

	it('landing page: live now links to the ferry app at its subdomain with a status lamp', async () => {
		const dom = await load('/');
		const liveList = /<ul class="live-list">([\s\S]*?)<\/ul>/.exec(dom);
		assert.ok(liveList, 'no live now list');
		const link = /<a class="live-link" href="https:\/\/ferrytimesmobile\.juliet\.nyc\/" data-project="ferry-times-mobile"[^>]*>([\s\S]*?)<\/a>/.exec(liveList[1]);
		assert.ok(link, 'no Ferry Times Mobile link in live now');
		assert.match(link[1], /class="dot"/, 'no status lamp');
		assert.match(link[1], /class="live-name">Ferry Times Mobile<\/span>/);
		assert.match(link[1], /class="live-url">ferrytimesmobile\.juliet\.nyc<\/span>/);
	});

	it('landing page: live now links to Subways for Nerds at its subdomain with a status lamp', async () => {
		const dom = await load('/');
		const liveList = /<ul class="live-list">([\s\S]*?)<\/ul>/.exec(dom);
		assert.ok(liveList, 'no live now list');
		const link = /<a class="live-link" href="https:\/\/subwaysfornerds\.juliet\.nyc\/" data-project="subways-for-nerds"[^>]*>([\s\S]*?)<\/a>/.exec(liveList[1]);
		assert.ok(link, 'no Subways for Nerds link in live now');
		assert.match(link[1], /class="dot"/, 'no status lamp');
		assert.match(link[1], /class="live-name">Subways for Nerds<\/span>/);
		assert.match(link[1], /class="live-url">subwaysfornerds\.juliet\.nyc<\/span>/);
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

	it('landing page: nycferry has a matching download and copyable install command', async () => {
		const dom = await load('/');
		const at = dom.indexOf('href="https://github.com/jefuhr/nycferry#install"');
		assert.ok(at > -1, 'no link to the nycferry install instructions');
		assert.ok(at > dom.indexOf('downloads') && at < dom.indexOf('from the blog'), 'nycferry should sit in downloads');
		const code = /<code id="nycferry-install">([\s\S]*?)<\/code>/.exec(dom);
		assert.equal(code?.[1].replace(/<[^>]+>/g, ''), NYCFERRY_INSTALL, 'install one-liner missing or changed');
		const button = /<button[^>]*data-copy="nycferry-install"[^>]*>/.exec(dom);
		assert.ok(button, 'no nycferry copy button');
		assert.doesNotMatch(button[0], /\bhidden\b/, 'nycferry copy button should be revealed once JS runs');
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
