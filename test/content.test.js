'use strict';

// The hand-edited parts of the site: posts.json, projects.json, the pages'
// links, and the nginx config. Each check here is a mistake that has either
// happened already or would fail silently in the browser.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers');

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function readJson(file) {
	try {
		return JSON.parse(read(file));
	} catch (err) {
		assert.fail(`${file} is not valid JSON: ${err.message}`);
	}
}

describe('posts.json', () => {
	const { posts } = readJson('posts.json');

	it('has a list of posts', () => {
		assert.ok(Array.isArray(posts) && posts.length > 0);
	});

	it('gives every post a unique, URL-safe slug', () => {
		const seen = new Set();
		for (const post of posts) {
			assert.match(post.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
				`slug "${post.slug}" should be lowercase-words-with-dashes; it becomes /blog/#${post.slug}`);
			assert.ok(!seen.has(post.slug), `slug "${post.slug}" is used twice`);
			seen.add(post.slug);
		}
	});

	it('gives every post a title, a real YYYY-MM-DD date, and a list of paragraphs', () => {
		for (const post of posts) {
			const name = `post "${post.slug}"`;
			assert.ok(typeof post.title === 'string' && post.title.trim(), `${name} needs a title`);
			assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/, `${name} date should look like 2026-08-10`);
			assert.equal(new Date(`${post.date}T00:00:00Z`).toISOString().slice(0, 10), post.date,
				`${name} date ${post.date} isn't on the calendar`);
			assert.ok(Array.isArray(post.body), `${name} body should be a list of paragraphs`);
			for (const paragraph of post.body) assert.equal(typeof paragraph, 'string', `${name} has a non-text paragraph`);
			for (const key of ['summary', 'tag']) {
				if (key in post) assert.equal(typeof post[key], 'string', `${name} ${key} should be text`);
			}
		}
	});
});

describe('live now', () => {
	it('has a projects.json entry for every status lamp in index.html, and no extras', () => {
		const onPage = [...read('index.html').matchAll(/data-project="([^"]+)"/g)].map((m) => m[1]).sort();
		const tracked = readJson('projects.json').projects.map((p) => p.id).sort();
		assert.deepEqual(onPage, tracked);
	});

	it('only probes https URLs', () => {
		for (const p of readJson('projects.json').projects) {
			assert.match(p.probe, /^https:\/\//, `${p.id} probe should be an https URL`);
		}
	});
});

describe('pages', () => {
	// served by other apps on the box (see deploy/nginx-juliet.nyc.conf)
	const OTHER_APPS = ['/ferryTimesMobile', '/lb/'];

	for (const [page, base] of [['index.html', '/'], ['blog/index.html', '/blog/']]) {
		it(`${page} only references files that exist, with matching case`, () => {
			for (const [, ref] of read(page).matchAll(/\b(?:src|href)="([^"]+)"/g)) {
				if (/^(?:#|mailto:|https?:|data:)/.test(ref)) continue;
				const { pathname } = new URL(ref, `http://site${base}`);
				if (OTHER_APPS.some((app) => pathname.startsWith(app))) continue;
				const file = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
				assert.ok(fs.existsSync(path.join(ROOT, file)), `${page} links ${ref}, but ${file} doesn't exist`);
			}
		});
	}
});

describe('nginx', () => {
	it('keeps the lb installer include, so deploy.sh --nginx doesn\'t take /lb/ down', () => {
		// jefuhr/lb's scripts/setup-server.sh looks for exactly these marker lines
		const conf = read('deploy/nginx-juliet.nyc.conf');
		const block = /^ *# >>> lb >>>\n *include \/etc\/nginx\/snippets\/lb\.conf;\n *# <<< lb <<<$/m.exec(conf);
		assert.ok(block, 'missing the "# >>> lb >>>" include block');
		assert.ok(block.index > conf.indexOf('server_name juliet.nyc'), 'lb block should be inside the juliet.nyc server block');
		assert.ok(block.index < conf.indexOf('listen 443 ssl'), 'lb block should sit above the TLS listen lines');
	});
});
