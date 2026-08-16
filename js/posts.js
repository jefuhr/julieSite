/**
 * Renders the blog from posts.json.
 *
 * Two consumers, one file:
 *   [data-headlines]  the "from the blog" card in the landing page sidebar —
 *                     the three most recent titles, linking into /blog/
 *   [data-posts]      the blog page itself — every post, in full
 *
 * Post bodies are plain text apart from markdown [text](url) links; raw HTML
 * is escaped, and only http(s), mailto, and same-site hrefs become anchors.
 *
 * posts.json is the only place a post is written down. If the fetch fails
 * (page opened straight off disk, server down), each page keeps the static
 * fallback it shipped with and still links to /blog/.
 */

(function () {
  'use strict';

  const headlineList = document.querySelector('[data-headlines]');
  const postList = document.querySelector('[data-posts]');
  if (!headlineList && !postList) return;

  const HEADLINE_COUNT = 3;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** "2026-08-10" -> "Aug 10, 2026". Anything unparseable comes back as-is. */
  function prettyDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!m) return value || '';
    const month = MONTHS[Number(m[2]) - 1];
    if (!month) return value;
    return `${month} ${Number(m[3])}, ${m[1]}`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * Which hrefs a post is allowed to link to: the open web, mail, and
   * anywhere on this site. Everything else (javascript:, data:, protocol
   *-relative //host) is refused and the link renders as literal text.
   */
  function safeHref(url) {
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
    if (/^#/.test(url)) return url;
    if (/^\/(?!\/)/.test(url)) return url;
    return null;
  }

  const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

  /**
   * One body paragraph. Markdown [text](url) becomes a real anchor; the
   * surrounding prose is set as text nodes, so raw HTML in a post is
   * escaped rather than rendered.
   */
  function paragraphNode(text) {
    const p = document.createElement('p');
    const source = String(text);
    let last = 0;

    for (let m; (m = LINK.exec(source)); ) {
      const href = safeHref(m[2]);
      if (last < m.index) p.append(source.slice(last, m.index));
      if (href) {
        const a = el('a', null, m[1]);
        a.href = href;
        p.append(a);
      } else {
        p.append(m[0]); // not a link we trust — leave the markdown as written
      }
      last = m.index + m[0].length;
    }
    LINK.lastIndex = 0;

    if (last < source.length) p.append(source.slice(last));
    return p;
  }

  function headlineItem(post) {
    const li = document.createElement('li');
    const a = el('a', 'headline-link');
    a.href = `/blog/#${post.slug}`;

    const body = el('span', 'headline-body');
    body.append(el('span', 'headline-title', post.title));
    if (post.summary) body.append(el('span', 'headline-summary', post.summary));

    a.append(el('span', 'headline-date', prettyDate(post.date)), body);
    li.append(a);
    return li;
  }

  function postArticle(post) {
    const article = el('article', 'post');
    article.id = post.slug || '';

    const head = el('div', 'post-head');
    head.append(el('time', 'post-date', prettyDate(post.date)));
    if (post.tag) head.append(el('span', 'chip', post.tag));
    article.append(head);

    const h2 = el('h2', 'post-title');
    const link = el('a', null, post.title);
    link.href = `#${post.slug}`;
    h2.append(link);
    article.append(h2);

    if (post.summary) article.append(el('p', 'post-summary', post.summary));
    for (const paragraph of post.body || []) article.append(paragraphNode(paragraph));

    return article;
  }

  function byDateDesc(a, b) {
    return String(b.date || '').localeCompare(String(a.date || ''));
  }

  async function load() {
    let posts;
    try {
      const res = await fetch('/posts.json', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      posts = (await res.json()).posts;
    } catch {
      return; // no server (or offline) — leave the static fallback in place
    }
    if (!Array.isArray(posts)) return;

    posts = posts.slice().sort(byDateDesc);

    if (headlineList) {
      const items = posts.slice(0, HEADLINE_COUNT).map(headlineItem);
      if (items.length) {
        headlineList.replaceChildren(...items);
        headlineList.hidden = false;
        for (const node of document.querySelectorAll('[data-headlines-fallback]')) node.remove();
      }
    }

    if (postList) {
      postList.replaceChildren(...posts.map(postArticle));
      if (!posts.length) postList.append(el('p', 'micro', 'nothing written down yet.'));

      // arriving at /blog/#slug: the target only exists now, so scroll to it
      if (location.hash.length > 1) {
        const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (target) target.scrollIntoView();
      }
    }
  }

  load();
})();
