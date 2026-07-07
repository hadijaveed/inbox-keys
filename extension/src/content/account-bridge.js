// account-bridge.js — runs in the PAGE'S MAIN world (manifest `world: "MAIN"`).
//
// The signed-in Google account list (every account's email + its /u/N index)
// lives on `window.gbar`, the OneGoogle bar's page global. Content scripts run
// in the ISOLATED world and cannot see page globals, so this tiny bridge reads
// the list out of gbar in the main world and hands it to the isolated world via
// window.postMessage. The isolated receiver (account-sync.js) persists it to the
// shared accountNames map, so the palette can show every account BY EMAIL on
// both Gmail and Calendar — no need to visit each account first.
//
// No new permission: a `world: "MAIN"` content script runs under the existing
// host_permissions. This is read-only — we never write to gbar or the page.
//
// Note: the full list is reliably present in gbar on mail.google.com; on
// calendar.google.com gbar usually carries only the current account, so this
// bridge just posts nothing there and Calendar relies on the shared map that
// Gmail populated (accountNames is shared chrome.storage).
(function () {
  "use strict";

  // Find the account list inside an arbitrary object graph WITHOUT depending on
  // Google's minified key names (they change between builds). The account array
  // is the first array of >=2 distinct objects that each own an email-valued
  // string property. Per account we read the email (by regex) and the /u/N index
  // (parsed from a URL-valued property); the lone entry with no switch URL is the
  // active account, resolved to the current index. DOM-tree links are pruned so
  // the crawl stays inside gbar instead of exploding into the whole document.
  function extractAccounts(root, currentIndex) {
    if (!root || typeof root !== "object") return [];
    const emailRe = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    const urlIdxRe = /\/u\/(\d+)(?:\/|\b)/;
    const DOM_SKIP = new Set([
      "parentNode", "parentElement", "childNodes", "children", "firstChild", "lastChild",
      "nextSibling", "previousSibling", "nextElementSibling", "previousElementSibling",
      "ownerDocument", "ownerElement", "documentElement", "body", "head", "defaultView",
      "activeElement", "firstElementChild", "lastElementChild", "offsetParent", "host", "shadowRoot",
    ]);
    const sget = (o, k) => { try { return o[k]; } catch (e) { return undefined; } };
    const bad = (v) => {
      try {
        if (typeof CSSStyleSheet !== "undefined" && v instanceof CSSStyleSheet) return true;
        if (typeof CSSRule !== "undefined" && v instanceof CSSRule) return true;
        if (typeof StyleSheetList !== "undefined" && v instanceof StyleSheetList) return true;
      } catch (e) { return true; }
      return false;
    };
    function readEl(el) {
      if (!el || typeof el !== "object") return null;
      let email = null, idx = null, name = null, c = 0;
      for (const k in el) {
        if (c++ > 150) break;
        const v = sget(el, k);
        if (typeof v !== "string") continue;
        if (!email && emailRe.test(v)) email = v;
        else if (idx == null) { const m = v.match(urlIdxRe); if (m) idx = +m[1]; }
      }
      if (!email) return null;
      c = 0;
      for (const k in el) {
        if (c++ > 150) break;
        const v = sget(el, k);
        if (typeof v === "string" && v !== email && !/[:/@]/.test(v) && v.length <= 60 && /[a-zA-Z]/.test(v)) { name = v; break; }
      }
      return { email, idx, name };
    }
    const seen = new Set();
    const q = [root];
    let nodes = 0;
    while (q.length && nodes < 120000) {
      const v = q.shift();
      nodes++;
      if (v == null || typeof v !== "object" || bad(v)) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      if (Array.isArray(v)) {
        if (v.length >= 2) {
          const withEmail = v.map(readEl).filter(Boolean);
          const distinct = new Set(withEmail.map((p) => p.email));
          if (distinct.size >= 2 && withEmail.length >= 2) {
            const noIdx = withEmail.filter((p) => p.idx == null);
            if (noIdx.length === 1 && currentIndex != null) noIdx[0].idx = currentIndex;
            const final = withEmail.filter((p) => p.idx != null);
            if (final.length >= 2) {
              const byIdx = new Map();
              for (const p of final) if (!byIdx.has(p.idx)) byIdx.set(p.idx, { index: p.idx, email: p.email, name: p.name || null });
              return [...byIdx.values()].sort((a, b) => a.index - b.index);
            }
          }
        }
        for (let i = 0; i < v.length && i < 600; i++) q.push(v[i]);
      } else {
        let c = 0;
        for (const k in v) {
          if (c++ > 600) break;
          if (DOM_SKIP.has(k)) continue;
          let val;
          try { val = v[k]; } catch (e) { continue; }
          if (val && typeof val === "object") q.push(val);
        }
      }
    }
    return [];
  }

  function currentIndex() {
    const m = location.pathname.match(/\/u\/(\d+)\b/);
    return m ? +m[1] : 0;
  }

  // gbar populates a beat after the page does; poll a few times, stop on success.
  function run() {
    let tries = 0;
    function tick() {
      tries++;
      let accts = [];
      try { accts = extractAccounts(window.gbar, currentIndex()); } catch (e) { accts = []; }
      if (accts.length) {
        try { window.postMessage({ __inboxkeys: "accounts", payload: JSON.stringify(accts) }, location.origin); } catch (e) {}
        return;
      }
      if (tries < 6) setTimeout(tick, 1500);
    }
    setTimeout(tick, 800);
  }

  if (typeof window === "undefined" && typeof module !== "undefined") {
    module.exports = { extractAccounts }; // unit tests (Node)
  } else {
    run();
  }
})();
