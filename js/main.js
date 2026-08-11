/**
 * Lights up the status dot on each "live now" link.
 *
 * Asks the server (/api/status) whether each project in projects.json is
 * reachable, then paints the matching link. Progressive enhancement only:
 * open index.html straight off disk with no server and the links still work,
 * they just keep their neutral dot.
 */

(function () {
  'use strict';

  const links = document.querySelectorAll('[data-project]');
  if (!links.length) return;

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
      const res = await fetch('/api/status', { headers: { accept: 'application/json' } });
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

  refresh();
  setInterval(refresh, 60_000);

  // don't hammer the box while the tab is in the background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
})();
