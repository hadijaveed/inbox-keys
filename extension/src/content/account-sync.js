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
window.InboxKeys = window.InboxKeys || {};

(function () {
  const emailRe = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  function ingest(list) {
    const storage = InboxKeys.storage;
    if (!storage || !Array.isArray(list) || !list.length) return false;
    const names = { ...(storage.get("accountNames") || {}) };
    let changed = false;
    for (const a of list) {
      const idx = Number(a && a.index);
      const email = a && a.email;
      if (!Number.isInteger(idx) || idx < 0 || idx > 25) continue;
      if (typeof email !== "string" || !emailRe.test(email)) continue;
      if (names[String(idx)] !== email) {
        names[String(idx)] = email;
        changed = true;
      }
    }
    if (changed) storage.set({ accountNames: names });
    return changed;
  }

  function onMessage(e) {
    if (e.source !== window) return;
    if (e.origin && e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.__inboxkeys !== "accounts" || typeof d.payload !== "string") return;
    let list;
    try { list = JSON.parse(d.payload); } catch (_) { return; }
    ingest(list);
  }

  window.addEventListener("message", onMessage, false);
  InboxKeys.accountSync = { ingest };
})();
