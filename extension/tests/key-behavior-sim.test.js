const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const hotkeysSource = fs.readFileSync(path.join(root, "src/content/hotkeys.js"), "utf8");
const gmailSource = fs.readFileSync(path.join(root, "src/content/gmail.js"), "utf8");

function canOverrideEditable({ target, key, ctx, hash = "", metaKey = false, ctrlKey = false, altKey = false, searchEditing = false }) {
  if (target !== "search") return false;
  if (!/^#search\//.test(hash || "")) return false;
  if (ctx !== "threadView" && ctx !== "inboxList") return false;
  if (metaKey || ctrlKey || altKey) return false;
  if (searchEditing) return false;

  const normalized = key.length === 1 ? key.toLowerCase() : key;
  return [
    "ArrowDown",
    "ArrowUp",
    "Enter",
    "Escape",
    "Tab",
    "j",
    "k",
    "e",
    "x",
    ":",
    ";",
  ].includes(normalized);
}

assert.equal(
  canOverrideEditable({ target: "search", key: "Enter", ctx: "inboxList", hash: "#inbox" }),
  false,
  "Enter should keep submitting the search form before a search result route exists"
);

assert.equal(
  canOverrideEditable({ target: "search", key: "Enter", ctx: "inboxList", hash: "#search/is%3Aunread" }),
  true,
  "Enter should open the selected row after Gmail has navigated to search results"
);

assert.equal(
  canOverrideEditable({ target: "search", key: "j", ctx: "inboxList", hash: "#search/is%3Aunread" }),
  true,
  "j should move the list cursor even when Gmail leaves focus in the search box"
);

assert.equal(
  canOverrideEditable({ target: "search", key: "j", ctx: "inboxList", hash: "#search/is%3Aunread", searchEditing: true }),
  false,
  "j should remain typeable while the search input is in typing mode"
);

assert.equal(
  canOverrideEditable({ target: "search", key: "Escape", ctx: "threadView", hash: "#search/is%3Aunread/FMfcgz123456" }),
  true,
  "Escape should still leave a thread opened from search results"
);

assert.equal(
  canOverrideEditable({ target: "compose", key: "j", ctx: "compose", hash: "#search/is%3Aunread" }),
  false,
  "Compose bodies remain protected from global shortcuts"
);

assert.equal(
  canOverrideEditable({ target: "search", key: "a", ctx: "inboxList", hash: "#search/is%3Aunread" }),
  false,
  "Printable search typing should not be stolen from the search input"
);

assert.equal(
  canOverrideEditable({ target: "search", key: "j", ctx: "inboxList", hash: "#search/is%3Aunread", metaKey: true }),
  false,
  "Browser or OS modifier shortcuts should not be stolen"
);

assert.match(
  hotkeysSource,
  /if \(isEditable\(e\.target\) && !canOverrideEditable\(e, ctx\)\) return;/,
  "Hotkeys should use the search-result stale-focus override"
);

assert.match(
  hotkeysSource,
  /document\.addEventListener\("pointerdown",/,
  "Clicking Gmail search should enter deterministic search typing mode"
);

assert.match(
  fs.readFileSync(path.join(root, "src/content/commands.js"), "utf8"),
  /CMDK\.hotkeys\.armSearchEditing\(\)/,
  "The / search command should arm search typing before focusing Gmail search"
);

assert.doesNotMatch(
  hotkeysSource,
  /searchEditingUntil|Date\.now\(\)/,
  "Search focus handling should not depend on a timer window"
);

assert.doesNotMatch(
  gmailSource,
  /openReplyAllFromMessageMenu/,
  "Reply-all should not open the message overflow menu"
);

assert.match(
  gmailSource,
  /inThread\(\) && Array\.from\(document\.querySelectorAll\('\[role="main"\] \[data-message-id\]'\)\)/,
  "Thread context should be detected before searchFocused"
);

assert.match(
  gmailSource,
  /exactButton\("Reply to all", scope\)/,
  "Reply-all fallback lookup should stay scoped to the selected message card"
);

// Reply-all clicks Gmail's inline "Reply all" button and must NEVER open the
// response-type caret menu: that menu popped up over the compose box and fought
// with typing, and on a two-person thread there is nothing to switch to anyway.
assert.doesNotMatch(
  gmailSource,
  /Type of response/,
  "Reply-all must not drive the response-type caret menu (it conflicted with typing)"
);
assert.match(
  gmailSource,
  /function inlineReplyAll/,
  "Reply-all should click the inline Reply all button"
);

assert.doesNotMatch(
  fs.readFileSync(path.join(root, "src/content/threadnav.js"), "utf8"),
  /expandFocused/,
  "Moving the thread cursor must not auto-expand focused messages"
);

// isEditable must tolerate a non-Element keydown target. A keydown's target can
// be the document/window (no getAttribute/tagName), which threw
// "el.getAttribute is not a function" and killed the entire keydown handler.
function isEditable(el) {
  if (!el || typeof el.getAttribute !== "function") return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    el.getAttribute("role") === "textbox"
  );
}

assert.equal(isEditable(null), false);
assert.equal(isEditable({}), false, "a target with no getAttribute must be non-editable, not throw");
assert.equal(isEditable({ nodeType: 9, tagName: undefined }), false, "the document object must not throw");
assert.equal(isEditable({ tagName: "INPUT", getAttribute: () => null }), true);
assert.equal(isEditable({ tagName: "DIV", isContentEditable: false, getAttribute: () => "textbox" }), true, "role=textbox is editable");
assert.equal(isEditable({ tagName: "DIV", isContentEditable: false, getAttribute: () => null }), false);

assert.match(
  hotkeysSource,
  /typeof el\.getAttribute !== "function"/,
  "isEditable must guard against non-Element keydown targets (document/window)"
);

console.log("key behavior simulations passed");
