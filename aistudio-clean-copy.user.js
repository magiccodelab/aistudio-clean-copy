// ==UserScript==
// @name              Google AI Studio Clean Copy Markdown
// @name:en           Google AI Studio Clean Copy Markdown
// @name:zh           Google AI Studio 完整复制 Markdown
// @name:zh-CN        Google AI Studio 完整复制 Markdown
// @namespace         https://github.com/magiccodelab/aistudio-clean-copy
// @version           1.2.3
// @description       One-click copy of a complete Google AI Studio reply as Markdown: body, citations, Sources. Unwraps google.com/url and vertexaisearch grounding redirects.
// @description:en    One-click copy of a complete Google AI Studio reply as Markdown: body, citations, Sources. Unwraps google.com/url and vertexaisearch grounding redirects.
// @description:zh    一键复制 Google AI Studio 完整回复为 Markdown：正文、文内引用、底部 Sources；还原 google.com/url 与 vertexaisearch 重定向。
// @description:zh-CN 一键复制 Google AI Studio 完整回复为 Markdown：正文、文内引用、底部 Sources；还原 google.com/url 与 vertexaisearch 重定向。
// @author            afeng (magiccodelab)
// @license           MIT
// @homepageURL       https://github.com/magiccodelab/aistudio-clean-copy
// @supportURL        https://github.com/magiccodelab/aistudio-clean-copy/issues
// @downloadURL       https://raw.githubusercontent.com/magiccodelab/aistudio-clean-copy/main/aistudio-clean-copy.user.js
// @updateURL         https://raw.githubusercontent.com/magiccodelab/aistudio-clean-copy/main/aistudio-clean-copy.user.js
// @match             https://aistudio.google.com/prompts/*
// @match             https://aistudio.google.com/u/*/prompts/*
// @run-at            document-idle
// @grant             GM_xmlhttpRequest
// @grant             GM_setClipboard
// @grant             GM_setValue
// @grant             GM_getValue
// @grant             GM_addStyle
// @connect           vertexaisearch.cloud.google.com
// @connect           *
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;
  if (!/^\/(?:u\/\d+\/)?prompts\//.test(location.pathname)) return;

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const CONCURRENCY = 8;
  const TIMEOUT_MS = 10000;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const CACHE_KEY = 'aistudio_clean_copy_cache_v1';
  const TOOLBAR_SEL = '.actions.hover-or-edit';
  const BTN_CLASS = 'ais-clean-copy-btn';
  const SKIP_SEL = 'button, svg, script, style, textarea, input, ms-chat-turn-options, ms-grounding-sources, ms-thought-chunk, ms-search-entry-point, ms-hallucinations-disclaimer, mat-expansion-panel-header, .actions';

  const VERTEX_BODY = String.raw`https?:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[A-Za-z0-9_\-=%]+`;
  const GOOGLE_BODY = String.raw`https?:\/\/(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}(?:\.[a-z]{2})?\/url\?[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+`;
  const reVertex = new RegExp('^' + VERTEX_BODY + '$', 'i');
  const reGoogle = new RegExp('^' + GOOGLE_BODY + '$', 'i');
  const reURL = new RegExp(GOOGLE_BODY + '|' + VERTEX_BODY, 'gi');
  const TRACKING_KEYS = /^(utm_|spm$|fbclid$|gclid$|gbraid$|wbraid$|yclid$|mc_eid$|clid$|_hs)/i;

  const mem = new Map();
  const inflight = new Map();
  let persist = {};
  try { persist = GM_getValue(CACHE_KEY, {}) || {}; } catch { persist = {}; }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function uniq(arr) {
    return [...new Set((arr || []).filter(Boolean))];
  }

  function now() {
    return Date.now();
  }

  function cacheGet(k) {
    const m = mem.get(k);
    if (m && m.exp > now()) return m.dst;
    const p = persist[k];
    if (p && p.exp > now() && p.dst) {
      mem.set(k, p);
      return p.dst;
    }
    return '';
  }

  function cachePut(k, dst) {
    const e = { dst, exp: now() + CACHE_TTL_MS };
    mem.set(k, e);
    persist[k] = e;
    const keys = Object.keys(persist);
    if (keys.length > 3000) {
      keys.sort((a, b) => (persist[a].exp || 0) - (persist[b].exp || 0));
      for (const old of keys.slice(0, keys.length - 2500)) delete persist[old];
    }
    try { GM_setValue(CACHE_KEY, persist); } catch {}
  }

  function canon(m) {
    m = String(m || '').replace(/\\\//g, '/');
    if (m.length > 4 && m.slice(0, 5).toLowerCase() === 'http:') m = 'https:' + m.slice(5);
    return m;
  }

  function splitMatch(m) {
    if (reGoogle.test(m)) {
      const k = m.replace(/[.,;:!?\\]+$/, '');
      return { key: canon(k), rest: m.slice(k.length) };
    }
    return { key: canon(m), rest: '' };
  }

  function unwrapGoogle(u) {
    let cur = u;
    for (let i = 0; i < 3; i++) {
      if (!reGoogle.test(cur)) return cur;
      const s = cur.replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
      let p;
      try { p = new URL(s); } catch { throw new Error('Google 跳转链接解析失败'); }
      const t = p.searchParams.get('q') || p.searchParams.get('url') || '';
      let tp;
      try { tp = new URL(t); } catch { tp = null; }
      if (!t || !tp || !tp.host || (tp.protocol !== 'http:' && tp.protocol !== 'https:')) {
        throw new Error('Google 跳转链接缺少有效的目标地址');
      }
      cur = t;
    }
    return cur;
  }

  function stripTracking(urlStr) {
    try {
      const u = new URL(urlStr);
      [...u.searchParams.keys()].forEach((k) => {
        if (TRACKING_KEYS.test(k)) u.searchParams.delete(k);
      });
      u.hash = '';
      return u.toString();
    } catch {
      return urlStr;
    }
  }

  function parseLocation(headers) {
    const m = String(headers || '').match(/^location:\s*(.+)$/im);
    return m ? m[1].trim() : '';
  }

  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        anonymous: true,
        timeout: TIMEOUT_MS,
        ...opts,
        onload: resolve,
        onerror: () => reject(new Error('net')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  async function resolveVertex(u) {
    let last = '';
    for (let i = 0; i <= 2; i++) {
      if (i) await sleep(i * 200);
      try {
        const r = await gmRequest({ method: i === 2 ? 'GET' : 'HEAD', url: u });
        const loc = parseLocation(r.responseHeaders);
        const code = r.status || r.statusCode || 0;
        if (loc && code >= 300 && code < 400) return loc;
        if (r.finalUrl && !/grounding-api-redirect/i.test(r.finalUrl) && r.finalUrl !== u) {
          return r.finalUrl;
        }
        last = 'HTTP ' + code + ' 无 Location';
        if (code >= 400 && code < 500 && code !== 429) break;
      } catch (e) {
        last = e && e.message ? e.message : 'net';
      }
    }
    throw new Error(last || '还原失败');
  }

  async function resolveOne(raw) {
    const { key } = splitMatch(raw);
    const cached = cacheGet(key);
    if (cached) return cached;
    if (inflight.has(key)) return inflight.get(key);

    const job = (async () => {
      let u = key;
      if (reGoogle.test(u)) {
        let inner;
        try { inner = unwrapGoogle(u); } catch { return ''; }
        if (!reVertex.test(inner)) {
          const dst = stripTracking(inner);
          cachePut(key, dst);
          return dst;
        }
        u = canon(inner);
        const hit = cacheGet(u);
        if (hit) {
          cachePut(key, hit);
          return hit;
        }
      }
      if (!reVertex.test(u)) return '';
      try {
        let dest = await resolveVertex(u);
        try { new URL(dest); } catch { return ''; }
        if (reGoogle.test(dest)) {
          try { dest = unwrapGoogle(dest); } catch {}
        }
        dest = stripTracking(dest);
        cachePut(u, dest);
        cachePut(key, dest);
        return dest;
      } catch {
        return '';
      }
    })();

    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }

  async function resolveText(text) {
    const src = String(text || '');
    const matches = src.match(reURL) || [];
    const keys = [];
    const idx = new Map();
    for (const m of matches) {
      const k = splitMatch(m).key;
      if (!idx.has(k)) {
        idx.set(k, keys.length);
        keys.push(k);
      }
    }
    const dests = new Array(keys.length).fill('');
    let i = 0;
    async function worker() {
      while (i < keys.length) {
        const n = i++;
        dests[n] = await resolveOne(keys[n]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length || 1) }, worker));

    reURL.lastIndex = 0;
    return src.replace(reURL, (m) => {
      const { key, rest } = splitMatch(m);
      const d = dests[idx.get(key)];
      return d ? d + rest : m;
    });
  }

  function qsa(root, sel) {
    return [...(root || document).querySelectorAll(sel)];
  }

  function isModelTurn(turn) {
    return !!turn && (
      turn.querySelector('ms-grounding-sources') ||
      turn.querySelector('button[aria-label="Good response"],button[aria-label="Bad response"]')
    );
  }

  function tidyMd(s) {
    return String(s || '')
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/^\n+/, '')
      .replace(/\s+$/, '');
  }

  function kids(node, ctx) {
    let out = '';
    for (const child of node.childNodes) out += ser(child, ctx);
    return out;
  }

  function ser(node, ctx) {
    ctx = ctx || {};
    if (node.nodeType === 3) return node.nodeValue.replace(/\u00a0/g, ' ');
    if (node.nodeType !== 1) return '';
    if (node.matches && node.matches(SKIP_SEL)) return '';

    const tag = node.tagName;

    if (tag === 'MS-CODE-BLOCK') {
      const lang = node.getAttribute('data-test-language') || '';
      const pre = node.querySelector('pre');
      const code = String(pre ? pre.textContent : '').replace(/\n$/, '');
      return '\n\n```' + lang + '\n' + code + '\n```\n\n';
    }
    if (tag === 'PRE') {
      const code = String(node.textContent || '').replace(/\n$/, '');
      return '\n\n```\n' + code + '\n```\n\n';
    }
    if (tag === 'BR') return '\n';
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'STRONG' || tag === 'B') return '**' + kids(node, { inline: true }) + '**';
    if (tag === 'EM' || tag === 'I') return '*' + kids(node, { inline: true }) + '*';
    if (node.classList && node.classList.contains('inline-code')) {
      return '`' + String(node.textContent || '').replace(/`/g, '\\`') + '`';
    }
    if (tag === 'A') {
      const href = node.href || node.getAttribute('href') || '';
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!href || href === location.href) return kids(node, { inline: true });
      return '[' + (text || '链接') + '](' + href + ')';
    }
    if (/^H[1-6]$/.test(tag)) {
      return '\n\n' + '#'.repeat(+tag[1]) + ' ' + kids(node, { inline: true }).trim() + '\n\n';
    }
    if (tag === 'P') {
      const inner = kids(node, { inline: true });
      if (!inner.trim()) return '';
      return ctx.inLi ? inner + '\n' : inner + '\n\n';
    }
    if (tag === 'LI') {
      const inner = kids(node, { inLi: true }).replace(/\s+$/, '');
      const parent = node.parentElement;
      const lis = parent ? [...parent.children].filter((c) => c.tagName === 'LI') : [];
      const bullet = parent && parent.tagName === 'OL' ? (lis.indexOf(node) + 1) + '. ' : '- ';
      const pad = ' '.repeat(bullet.length);
      const body = inner.split('\n').map((ln, i) => {
        if (i === 0) return bullet + ln;
        return ln ? pad + ln : '';
      }).join('\n');
      return body + '\n';
    }
    if (tag === 'UL' || tag === 'OL') return '\n' + kids(node, { inLi: true }) + '\n';
    if (tag === 'BLOCKQUOTE') {
      const inner = kids(node, { inLi: true }).trim();
      return '\n\n' + inner.split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
    }
    return kids(node, ctx);
  }

  function readRawBox(turn) {
    const box = turn && turn.querySelector('.very-large-text-container');
    return box ? tidyMd(box.textContent) : '';
  }

  function serializeTurn(turn) {
    const chunk = turn.querySelector('ms-text-chunk') || turn;
    return tidyMd(ser(chunk));
  }

  function getTurnMarkdown(turn) {
    return readRawBox(turn) || serializeTurn(turn);
  }

  function sourceItems(turn) {
    const items = [];
    const seen = new Set();
    for (const a of qsa(turn, 'ms-grounding-sources a[href]')) {
      const href = a.href;
      if (!href || seen.has(href)) continue;
      seen.add(href);
      items.push({
        title: String(a.textContent || '').replace(/\s+/g, ' ').trim() || href,
        href,
      });
    }
    return items;
  }

  async function appendSources(md, turn) {
    const items = sourceItems(turn);
    if (!items.length || /\n## (?:Sources|来源)\s*\n/i.test(md)) return md;
    const lines = [];
    for (let i = 0; i < items.length; i++) {
      const url = (await resolveOne(items[i].href)) || items[i].href;
      const title = items[i].title.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
      lines.push((i + 1) + '. [' + title + '](' + url + ')');
    }
    return md.replace(/\s+$/, '') + '\n\n## ' + t.sources + '\n\n' + lines.join('\n') + '\n';
  }

  function browserLangs() {
    const list = [];
    try {
      if (Array.isArray(navigator.languages)) list.push(...navigator.languages);
    } catch {}
    try {
      if (navigator.language) list.push(navigator.language);
    } catch {}
    try {
      if (W.navigator && W.navigator.language) list.push(W.navigator.language);
    } catch {}
    return list.map((s) => String(s || '').toLowerCase());
  }

  function isZhBrowser() {
    return browserLangs().some((l) => l === 'zh' || l.startsWith('zh-'));
  }

  const I18N = {
    en: {
      btn: 'Copy Markdown',
      copying: 'Copying…',
      copied: 'Copied',
      empty: 'Nothing to copy',
      fail: 'Copy failed',
      sources: 'Sources',
    },
    zh: {
      btn: '复制 Markdown',
      copying: '正在复制…',
      copied: '已复制',
      empty: '没有可复制的内容',
      fail: '复制失败',
      sources: '来源',
    },
  };
  const t = I18N[isZhBrowser() ? 'zh' : 'en'];

  function copyText(text) {
    try { GM_setClipboard(String(text), 'text'); } catch {}
    try {
      const clip = W.navigator && W.navigator.clipboard;
      if (clip && clip.writeText) return clip.writeText(String(text));
    } catch {}
    return Promise.resolve();
  }

  function toast(text, kind) {
    let el = document.getElementById('ais-clean-copy-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ais-clean-copy-toast';
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.dataset.kind = kind || 'ok';
    el.dataset.show = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.dataset.show = '0'; }, 1600);
  }

  function setBtnState(btn, icon, busy) {
    const span = btn.querySelector('.material-symbols-outlined');
    if (span) span.textContent = icon;
    btn.classList.toggle('ais-busy', !!busy);
  }

  async function copyTurn(turn, btn) {
    setBtnState(btn, 'hourglass_empty', true);
    toast(t.copying, 'busy');
    try {
      let md = getTurnMarkdown(turn);
      if (!md.trim()) throw new Error(t.empty);
      md = await resolveText(md);
      md = await appendSources(md, turn);
      await copyText(md);
      setBtnState(btn, 'check', false);
      toast(t.copied);
    } catch (e) {
      console.warn('[ais-clean-copy]', e);
      setBtnState(btn, 'error', false);
      toast(t.fail, 'err');
    }
    setTimeout(() => setBtnState(btn, 'markdown_copy', false), 1200);
  }

  function createButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mat-mdc-tooltip-trigger ms-button-borderless ms-button-icon ' + BTN_CLASS;
    btn.setAttribute('ms-button', '');
    btn.setAttribute('variant', 'icon-borderless');
    btn.setAttribute('aria-label', t.btn);
    btn.title = t.btn;
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined notranslate ms-button-icon-symbol';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'markdown_copy';
    btn.appendChild(icon);
    return btn;
  }

  function enhanceToolbar(toolbar) {
    if (!toolbar || toolbar.querySelector('.' + BTN_CLASS)) return;
    const turn = toolbar.closest('ms-chat-turn');
    if (!isModelTurn(turn)) return;
    const menu = toolbar.querySelector('ms-chat-turn-options');
    const btn = createButton();
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyTurn(turn, btn);
    });
    if (menu) toolbar.insertBefore(btn, menu);
    else toolbar.appendChild(btn);
  }

  function scan(root) {
    const base = root && root.querySelectorAll ? root : document;
    if (root && root.matches && root.matches(TOOLBAR_SEL)) enhanceToolbar(root);
    qsa(base, TOOLBAR_SEL).forEach(enhanceToolbar);
  }

  function prewarmTurn(turn) {
    if (!isModelTurn(turn)) return;
    const hrefs = uniq(qsa(turn, 'a[href]').map((a) => a.href).filter((h) => {
      reURL.lastIndex = 0;
      return reURL.test(h);
    }));
    hrefs.forEach((h) => { resolveOne(h); });
  }

  GM_addStyle(`
    .${BTN_CLASS} { margin: 0 2px; cursor: pointer; }
    .${BTN_CLASS} span.material-symbols-outlined { color: #34a853 !important; }
    .${BTN_CLASS}.ais-busy { opacity: .6; pointer-events: none; }
    #ais-clean-copy-toast {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      padding: 8px 12px; border-radius: 8px;
      font: 13px/1.4 "Google Sans", system-ui, sans-serif;
      background: #1f1f1f; color: #fff;
      opacity: 0; pointer-events: none;
      transform: translateY(6px);
      transition: opacity .12s ease, transform .12s ease;
    }
    #ais-clean-copy-toast[data-show="1"] { opacity: .94; transform: none; }
    #ais-clean-copy-toast[data-kind="err"] { background: #b3261e; }
    #ais-clean-copy-toast[data-kind="busy"] { background: #3c4043; }
  `);

  scan(document);
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) scan(n);
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('pointerover', (e) => {
    const turn = e.target && e.target.closest && e.target.closest('ms-chat-turn');
    if (turn) prewarmTurn(turn);
  }, true);

  setTimeout(() => {
    qsa(document, 'ms-chat-turn').forEach(prewarmTurn);
  }, 400);
})();
