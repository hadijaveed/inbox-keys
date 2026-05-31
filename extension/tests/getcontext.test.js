// End-to-end classifier test: runs the REAL gmail.js getContext() against jsdom
// fixtures of (hash + DOM + focus). This is the regression net for the search-box
// bug — it proves a thread opened from search classifies as "threadView" (so the
// j/k/Enter/Escape/e shortcuts fire) and that lists never do.
//
// Skips cleanly if jsdom isn't installed (npm i is optional for a quick clone).
const assert = require("node:assert/strict");
const { tryLoad } = require("./helpers.js");

if (!tryLoad("")) {
  console.log("getContext tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

const ID = "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw"; // real 32-char id
const MSG = '<div role="main"><div data-message-id="m1">message body</div></div>';
const LIST = '<div role="main"><div gh="tl"><table><tr class="zA"><td>row</td></tr></table></div></div>';
const SEARCH = '<input aria-label="Search mail" name="q">';
const COMPOSE = '<div aria-label="Message Body" contenteditable="true"></div>';

// Fresh window per case so DOM/hash/focus never leak between assertions.
function ctx({ hash = "#inbox", html = "", paletteOpen = false, focus = null }) {
  const w = tryLoad(html);
  w.__paletteOpen = paletteOpen;
  w.location.hash = hash;
  if (focus) {
    const el = w.document.querySelector(focus);
    if (el) el.focus();
  }
  return w.CMDK.gmail.getContext();
}

// ---- THE REGRESSION: a thread opened from the search box ----
assert.equal(
  ctx({ hash: "#search/adam/" + ID, html: MSG }),
  "threadView",
  "thread opened from a text search must be threadView (was 'unknown' — the bug)"
);
assert.equal(
  ctx({ hash: "#search/is%3Aunread/" + ID, html: MSG }),
  "threadView",
  "thread opened from a search-operator query must be threadView"
);
// The killer case: search box still holds focus, but the thread must win.
assert.equal(
  ctx({ hash: "#search/adam/" + ID, html: MSG + SEARCH, focus: 'input[name="q"]' }),
  "threadView",
  "thread must beat stale search-box focus (priority order)"
);

// ---- Threads from other surfaces still work ----
assert.equal(ctx({ hash: "#inbox/" + ID, html: MSG }), "threadView", "inbox thread");
assert.equal(ctx({ hash: "#label/Clients/" + ID, html: MSG }), "threadView", "label thread");

// ---- Lists must NOT be threadView (the DOM guard at work) ----
assert.equal(ctx({ hash: "#inbox", html: LIST }), "inboxList", "inbox list");
assert.equal(ctx({ hash: "#search/adam", html: LIST }), "inboxList", "search results list");
// Long single-word query is thread-SHAPED by hash alone; with no message in the
// DOM the guard keeps it a list. This is what makes the low id-floor safe.
assert.equal(
  ctx({ hash: "#search/supercalifragilistic20x", html: LIST }),
  "inboxList",
  "long bare-word query stays inboxList — DOM guard rejects the shape match"
);

// ---- Search box focused with no list/thread surface ----
assert.equal(
  ctx({ hash: "#search/adam", html: SEARCH, focus: 'input[name="q"]' }),
  "searchFocused",
  "search box focused, nothing rendered yet"
);

// ---- Higher-priority contexts still pre-empt correctly ----
assert.equal(ctx({ hash: "#inbox", html: LIST, paletteOpen: true }), "paletteOpen", "palette wins over everything");
assert.equal(ctx({ hash: "#inbox", html: '<div role="dialog">x</div>' + LIST }), "modalOpen", "dialog wins over list");
assert.equal(ctx({ hash: "#inbox", html: COMPOSE }), "compose", "standalone compose body");
// A reply inside a thread is NOT 'compose' (body present but inThread) — it stays
// threadView so message-nav keeps working; Escape-exit is handled separately.
assert.equal(ctx({ hash: "#inbox/" + ID, html: MSG + COMPOSE }), "threadView", "inline reply stays threadView, not compose");

console.log("getContext tests passed");
