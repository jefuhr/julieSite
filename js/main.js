/**
 * Landing page enhancements. Progressive only: open index.html straight off
 * disk with no server and everything still works, just without these.
 *
 *   status lamps   asks the server (/_api/status) whether each project in
 *                  projects.json is reachable, then paints the matching
 *                  [data-project] link. Links keep their neutral dot if the
 *                  server can't be reached.
 *   copy buttons   <button data-copy="some-id"> copies the text of #some-id.
 */

(function () {
	'use strict';

	/* ------------------------------------------------------------ status lamps */

	const links = document.querySelectorAll('[data-project]');
	const byId = new Map();
	for (const link of links) byId.set(link.dataset.project, link);

	function paint(link, state, label, title) {
		const dot = link.querySelector('.dot');
		const text = link.querySelector('[data-state-label]');
		if (dot) dot.dataset.state = state;
		if (text) text.textContent = label;
		if (title) link.title = title;
	}

	async function refresh() {
		let data;
		try {
			const res = await fetch('/_api/status', { headers: { accept: 'application/json' } });
			if (!res.ok) throw new Error(`status ${res.status}`);
			data = await res.json();
		} catch {
			return; // no server (or offline) — leave the neutral dots alone
		}

		for (const p of data.projects || []) {
			const link = byId.get(p.id);
			if (!link) continue;

			if (p.up) {
				paint(link, 'up', 'live', `${p.name} · HTTP ${p.code} in ${p.ms}ms`);
			} else {
				paint(link, 'down', 'down', `${p.name} · ${p.error || 'HTTP ' + p.code}`);
			}
		}
	}

	if (byId.size) {
		refresh();

		// don't hammer the box while the tab is in the background; catch up on return
		setInterval(() => { if (!document.hidden) refresh(); }, 60_000);
		document.addEventListener('visibilitychange', () => {
			if (!document.hidden) refresh();
		});
	}

	/* ----------------------------------------------------------- copy buttons */

	for (const button of document.querySelectorAll('button[data-copy]')) {
		const source = document.getElementById(button.dataset.copy);
		if (!source) continue;

		const label = button.textContent;
		let timer;

		button.hidden = false;
		button.addEventListener('click', async () => {
			let copied = false;
			try {
				await navigator.clipboard.writeText(source.textContent.trim());
				copied = true;
			} catch {
				// no clipboard access (old browser, plain http): select it for a manual copy
				getSelection().selectAllChildren(source);
			}

			button.textContent = copied ? 'copied ♡' : 'selected';
			button.toggleAttribute('data-copied', copied);
			clearTimeout(timer);
			timer = setTimeout(() => {
				button.textContent = label;
				button.removeAttribute('data-copied');
			}, 2000);
		});
	}
})();
