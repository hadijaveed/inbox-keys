// account-sync.js — ISOLATED world (loaded on Gmail + Calendar).
//
// Receives the signed-in account list posted by the MAIN-world bridge
// (account-bridge.js) and persists it to the shared accountNames map, so every
// account shows BY EMAIL in the palette on both surfaces. The list is enumerated
// on Gmail (where gbar carries it); because accountNames is shared chrome.storage,
// Calendar gets the same emails without re-enumerating.
//
// Everything coming off window.postMessage is untrusted page data: we accept it
// only from this same window + origin, with our marker, and validate every
// {index, email} before storing.
//
// Staleness is the enemy. Google's /u/N indices are NOT stable — signing an
// account in/out or reordering makes Google reshuffle them, so an account can
// move from /u/9 to /u/4. If we only ever ADD to the map, the old /u/9 entry
// lingers and switching to it redirects Gmail to /u/0 (looks like "switching is
// broken"). Two defenses below: a full Gmail snapshot REPLACES the map
// (ingestSnapshot), and even a merge enforces one-email-one-index (ingest).
window.InboxKeys = window.InboxKeys || {};

(function () {
  const emailRe = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  function sanitize(list) {
    const out = [];
    if (!Array.isArray(list)) return out;
    for (const a of list) {
      const idx = Number(a && a.index);
      const email = a && a.email;
      if (!Number.isInteger(idx) || idx < 0 || idx > 25) continue;
      if (typeof email !== "string" || !emailRe.test(email)) continue;
      out.push({ idx, email });
    }
    return out;
  }

  // Merge one or more {index,email} into the map. Enforces a bijection: when an
  // email arrives at a new index, any OTHER index still holding that email is
  // dropped, so an account that Google moved to a new /u/N never lingers at its
  // old one. Used for partial/opportunistic updates.
  function ingest(list) {
    const storage = InboxKeys.storage;
    if (!storage) return false;
    const clean = sanitize(list);
    if (!clean.length) return false;
    const names = { ...(storage.get("accountNames") || {}) };
    let changed = false;
    for (const { idx, email } of clean) {
      const key = String(idx);
      for (const k of Object.keys(names)) {
        if (k !== key && names[k] === email) {
          delete names[k];
          changed = true;
        }
      }
      if (names[key] !== email) {
        names[key] = email;
        changed = true;
      }
    }
    if (changed) storage.set({ accountNames: names });
    return changed;
  }

  // Authoritative full snapshot. Gmail's gbar carries the COMPLETE signed-in
  // list, so we REPLACE the whole map with exactly what was enumerated, pruning
  // any stale index left over from a removed account or a Google reshuffle.
  // Guarded so a transient partial read can't wipe the map: we require at least
  // two accounts and that the snapshot includes the current account index.
  function ingestSnapshot(list, currentIdx) {
    const storage = InboxKeys.storage;
    if (!storage) return false;
    const clean = sanitize(list);
    if (clean.length < 2) return false;
    if (currentIdx != null && !clean.some((a) => a.idx === currentIdx)) return false;
    const next = {};
    for (const { idx, email } of clean) {
      const key = String(idx);
      if (next[key] == null) next[key] = email; // first email wins per index
    }
    const prev = storage.get("accountNames") || {};
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    const same = prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === next[k]);
    if (same) return false;
    storage.set({ accountNames: next });
    return true;
  }

  function onMessage(e) {
    if (e.source !== window) return;
    if (e.origin && e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.__inboxkeys !== "accounts" || typeof d.payload !== "string") return;
    let list;
    try { list = JSON.parse(d.payload); } catch (_) { return; }
    if (d.full) ingestSnapshot(list, Number.isInteger(d.current) ? d.current : null);
    else ingest(list);
  }

  window.addEventListener("message", onMessage, false);
  InboxKeys.accountSync = { ingest, ingestSnapshot };
})();
