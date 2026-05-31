const assert = require("node:assert/strict");
const { tryLoadContentScripts } = require("./helpers.js");

if (!tryLoadContentScripts("")) {
  console.log("hotkey tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

const ID = "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw";

function listFixture() {
  return `
    <input aria-label="Search mail" name="q" />
    <div role="main">
      <div gh="tl">
        <table><tbody>
          <tr class="zA" data-row="one">
            <td><div role="checkbox" aria-checked="false"></div></td>
            <td><span class="bog">one</span></td>
            <td><div role="button" aria-label="Archive">Archive</div></td>
          </tr>
          <tr class="zA" data-row="two">
            <td><div role="checkbox" aria-checked="false"></div></td>
            <td><span class="bog">two</span></td>
            <td><div role="button" aria-label="Archive">Archive</div></td>
          </tr>
        </tbody></table>
      </div>
    </div>`;
}

function threadFixture() {
  return `
    <div role="main">
      <div role="listitem" data-card="first">
        <div class="gE">first header</div>
        <div class="a3s" data-message-id="m1">first body</div>
        <button class="ams">Reply all</button>
      </div>
      <div role="listitem" data-card="second">
        <div class="gE">second header</div>
        <div class="a3s" data-message-id="m2">second body</div>
        <button class="ams">Reply all</button>
      </div>
      <button aria-label="Expand all">Expand all</button>
    </div>`;
}

function replyFixture() {
  return `
    <div role="main">
      <div role="listitem" data-card="only">
        <div class="gE">header</div>
        <div class="a3s" data-message-id="m1">message body</div>
        <div class="reply-surface">
          <button aria-label="Discard draft">Discard</button>
          <div aria-label="Message Body" contenteditable="true"></div>
        </div>
      </div>
    </div>`;
}

function load(html, hash) {
  const w = tryLoadContentScripts(html);
  w.location.hash = hash || "#inbox";
  w.CMDK.hotkeys.install();
  return w;
}

function press(w, key, opts = {}) {
  const target = opts.target || w.document.activeElement || w.document.body;
  const event = new w.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: !!opts.metaKey,
    ctrlKey: !!opts.ctrlKey,
    altKey: !!opts.altKey,
    shiftKey: !!opts.shiftKey,
  });
  target.dispatchEvent(event);
  return event;
}

function rows(w) {
  return Array.from(w.document.querySelectorAll("tr.zA"));
}

function wireList(w) {
  for (const row of rows(w)) {
    row.querySelector('[role="checkbox"]').addEventListener("click", (event) => {
      const cb = event.currentTarget;
      cb.setAttribute("aria-checked", cb.getAttribute("aria-checked") === "true" ? "false" : "true");
    });
    row.querySelector(".bog").addEventListener("click", () => {
      w.__openedRow = row.getAttribute("data-row");
    });
    row.querySelector('[aria-label="Archive"]').addEventListener("click", () => {
      w.__archivedRow = row.getAttribute("data-row");
    });
  }
}

// Submitted search results often leave Gmail's search input focused. Navigation
// and action shortcuts must still target the visible list.
{
  const w = load(listFixture(), "#search/is%3Aunread");
  wireList(w);
  const search = w.document.querySelector('input[name="q"]');
  search.focus();

  const event = press(w, "j", { target: search });

  assert.equal(event.defaultPrevented, true, "j from stale search focus should be claimed");
  assert.equal(rows(w)[1].classList.contains("cmdk-cursor"), true, "j should move the list cursor");
}

// If the user intentionally enters search typing mode, shortcut letters and
// Enter must not leak through to the list under the existing search route.
{
  const w = load(listFixture(), "#search/is%3Aunread");
  wireList(w);
  const search = w.document.querySelector('input[name="q"]');

  press(w, "/", { target: w.document.body });
  assert.equal(w.document.activeElement, search, "/ should focus Gmail search");

  const jEvent = press(w, "j", { target: search });
  assert.equal(jEvent.defaultPrevented, false, "j should remain typeable in search mode");
  assert.equal(rows(w).some((row) => row.classList.contains("cmdk-cursor")), false, "search typing should not move the cursor");

  const enterEvent = press(w, "Enter", { target: search });
  assert.equal(enterEvent.defaultPrevented, false, "Enter should submit Gmail search, not open a row");
  assert.equal(w.__openedRow, undefined, "Enter while typing a search should not open the selected row");
}

// Once search typing is over, a stale focused search input should no longer
// block Enter from opening the selected search result.
{
  const w = load(listFixture(), "#search/is%3Aunread");
  wireList(w);
  const search = w.document.querySelector('input[name="q"]');
  search.focus();

  const event = press(w, "Enter", { target: search });

  assert.equal(event.defaultPrevented, true, "Enter from stale search focus should be claimed");
  assert.equal(w.__openedRow, "one", "Enter should open the cursor row in search results");
}

// Basic list triage shortcuts should drive the cursor row controls.
{
  const w = load(listFixture(), "#inbox");
  wireList(w);

  const selectEvent = press(w, "x", { target: w.document.body });
  assert.equal(selectEvent.defaultPrevented, true, "x should be claimed in the list");
  assert.equal(rows(w)[0].querySelector('[role="checkbox"]').getAttribute("aria-checked"), "true", "x should select the cursor row");

  const escapeEvent = press(w, "Escape", { target: w.document.body });
  assert.equal(escapeEvent.defaultPrevented, true, "Escape should be claimed when clearing selection");
  assert.equal(rows(w)[0].querySelector('[role="checkbox"]').getAttribute("aria-checked"), "false", "Escape should clear list selection");

  const archiveEvent = press(w, "e", { target: w.document.body });
  assert.equal(archiveEvent.defaultPrevented, true, "e should be claimed in the list");
  assert.equal(w.__archivedRow, "one", "e should archive the cursor row");
}

// Tab and Shift+Tab cycle split-inbox tabs only from the list context.
{
  const w = load(listFixture(), "#inbox");

  press(w, "Tab", { target: w.document.body });
  assert.equal(w.location.hash, "#search/is%3Aunread", "Tab should move to the next split-inbox tab");

  press(w, "Tab", { target: w.document.body, shiftKey: true });
  assert.equal(w.location.hash, "#inbox", "Shift+Tab should move to the previous split-inbox tab");
}

// Compose/reply bodies are protected: regular letters must not drive list
// navigation while the user is writing.
{
  const w = load(listFixture() + '<div aria-label="Message Body" contenteditable="true"></div>', "#inbox");
  const body = w.document.querySelector('[contenteditable="true"]');
  body.focus();

  const event = press(w, "j", { target: body });

  assert.equal(event.defaultPrevented, false, "typing in compose should not be claimed");
  assert.equal(rows(w).some((row) => row.classList.contains("cmdk-cursor")), false, "compose typing should not move the list cursor");
}

// Thread Enter reply-alls against the focused message card, not a global button.
{
  const w = load(threadFixture(), "#inbox/" + ID);
  for (const card of w.document.querySelectorAll('[role="listitem"]')) {
    card.querySelector(".ams").addEventListener("click", () => {
      w.__replyAllCard = card.getAttribute("data-card");
    });
  }

  press(w, "ArrowUp", { target: w.document.body });
  press(w, "Enter", { target: w.document.body });

  assert.equal(w.__replyAllCard, "first", "Enter should reply-all from the focused message card");
}

// Thread-level shortcuts that do not involve a reply composer.
{
  const w = load(threadFixture(), "#search/is%3Aunread/" + ID);
  const expand = w.document.querySelector('[aria-label="Expand all"]');
  expand.addEventListener("click", () => {
    w.__expandedAll = true;
  });

  const expandEvent = press(w, ":", { target: w.document.body });
  assert.equal(expandEvent.defaultPrevented, true, ": should be claimed in thread view");
  assert.equal(w.__expandedAll, true, ": should click the expand/collapse-all control");

  const escapeEvent = press(w, "Escape", { target: w.document.body });
  assert.equal(escapeEvent.defaultPrevented, true, "Escape should be claimed in thread view");
  assert.equal(w.location.hash, "#search/is%3Aunread", "Escape should return to the parent search results");
}

// Escape should leave an open inline reply before the thread back navigation is
// allowed to fire.
{
  const w = load(replyFixture(), "#inbox/" + ID);
  const body = w.document.querySelector('[contenteditable="true"]');
  const discard = w.document.querySelector('[aria-label="Discard draft"]');
  discard.addEventListener("click", () => {
    w.__discardedReply = true;
  });
  body.focus();

  const event = press(w, "Escape", { target: body });

  assert.equal(event.defaultPrevented, true, "Escape in reply mode should be claimed");
  assert.equal(w.__discardedReply, true, "Escape should discard/exit the reply first");
  assert.equal(w.location.hash, "#inbox/" + ID, "Escape in reply mode should not navigate back yet");
}

// Gmail menus/dialogs block global shortcuts.
{
  const w = load('<div role="menu">menu</div>' + listFixture(), "#inbox");

  const event = press(w, "j", { target: w.document.body });

  assert.equal(event.defaultPrevented, false, "j should not be claimed while a Gmail menu is open");
  assert.equal(rows(w).some((row) => row.classList.contains("cmdk-cursor")), false, "menus should block list movement");
}

// Shift+Arrow selection is a RANGE anchored where it began: Shift+Down grows it,
// Shift+Up shrinks it by DEselecting the row left behind (not just adding upward).
{
  const rowsHtml = ["a", "b", "c", "d"]
    .map((id) => `<tr class="zA" data-row="${id}"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">${id}</span></td></tr>`)
    .join("");
  const w = load(`<div role="main"><div gh="tl"><table><tbody>${rowsHtml}</tbody></table></div></div>`, "#inbox");
  for (const row of rows(w)) {
    row.querySelector('[role="checkbox"]').addEventListener("click", (e) => {
      const cb = e.currentTarget;
      cb.setAttribute("aria-checked", cb.getAttribute("aria-checked") === "true" ? "false" : "true");
    });
  }
  const checked = () => rows(w).map((r) => r.querySelector('[role="checkbox"]').getAttribute("aria-checked"));

  press(w, "ArrowDown", { target: w.document.body, shiftKey: true });
  assert.deepEqual(checked(), ["true", "true", "false", "false"], "Shift+Down selects the anchor row and the next");

  press(w, "ArrowDown", { target: w.document.body, shiftKey: true });
  assert.deepEqual(checked(), ["true", "true", "true", "false"], "Shift+Down grows the range downward");

  press(w, "ArrowUp", { target: w.document.body, shiftKey: true });
  assert.deepEqual(checked(), ["true", "true", "false", "false"], "Shift+Up deselects the row left behind and moves up");

  press(w, "ArrowUp", { target: w.document.body, shiftKey: true });
  assert.deepEqual(checked(), ["true", "false", "false", "false"], "Shift+Up keeps shrinking back toward the anchor");
}

// A message card whose only inline action is Reply + Forward (no inline reply-all),
// matching real Gmail. Clicking "Reply" opens a reply surface whose "Type of
// response" caret opens a Reply / Reply to all / Forward menu. Handlers mutate the
// DOM synchronously, so gmail.waitFor's first synchronous probe resolves the whole
// chain without timers.
function wireReplyAllSurface(w) {
  const main = w.document.querySelector('[role="main"]');
  const replyLink = Array.from(w.document.querySelectorAll(".ams")).find((el) => (el.textContent || "").trim() === "Reply");
  replyLink.addEventListener("click", () => {
    if (w.document.querySelector('[aria-label="Type of response"]')) return;
    const surface = w.document.createElement("div");
    surface.innerHTML =
      '<div role="button" aria-haspopup="true" aria-label="Type of response"></div>' +
      '<div aria-label="Message Body" contenteditable="true"></div>' +
      '<div role="button" aria-label="Send">Send</div>';
    surface.querySelector('[aria-label="Type of response"]').addEventListener("click", () => {
      if (surface.querySelector('[role="menu"]')) return;
      const menu = w.document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML =
        '<div role="menuitem">Reply</div>' +
        '<div role="menuitem">Reply to all</div>' +
        '<div role="menuitem">Forward</div>';
      menu.querySelectorAll('[role="menuitem"]').forEach((mi) =>
        mi.addEventListener("click", () => {
          w.__pickedResponse = (mi.textContent || "").trim();
        })
      );
      surface.appendChild(menu);
    });
    main.appendChild(surface);
  });
}

const REPLY_FIXTURE_NO_INLINE_ALL = `
  <div role="main">
    <div role="listitem" data-card="only">
      <div class="gE">header</div>
      <div class="a3s" data-message-id="m1">body</div>
      <span class="ams bkH">Reply</span>
      <span class="ams bkG">Forward</span>
    </div>
  </div>`;

// Enter in a thread must always REPLY-ALL, even when Gmail exposes no inline
// reply-all button (it must open a reply and drive the response-type menu).
{
  const w = load(REPLY_FIXTURE_NO_INLINE_ALL, "#inbox/" + ID);
  wireReplyAllSurface(w);

  press(w, "Enter", { target: w.document.body });

  assert.equal(w.__pickedResponse, "Reply to all", "Enter must reach Reply to all via the response-type menu when no inline reply-all exists");
}

// r is plain reply: it opens a reply but must NOT walk the menu to reply-all, so
// the two bindings stay distinct (Enter = all, r = single).
{
  const w = load(REPLY_FIXTURE_NO_INLINE_ALL, "#inbox/" + ID);
  wireReplyAllSurface(w);

  press(w, "r", { target: w.document.body });

  assert.equal(!!w.document.querySelector('[aria-label="Message Body"]'), true, "r should open a reply");
  assert.equal(w.__pickedResponse, undefined, "r must not switch the reply to reply-all");
}

// j/k move the thread's message cursor across cards; Enter reply-alls the focused
// one. (ArrowUp→first is covered above; this covers j→down.)
{
  const w = load(threadFixture(), "#inbox/" + ID);
  for (const card of w.document.querySelectorAll('[role="listitem"]')) {
    card.querySelector(".ams").addEventListener("click", () => {
      w.__replyAllCard = card.getAttribute("data-card");
    });
  }

  press(w, "j", { target: w.document.body });
  press(w, "Enter", { target: w.document.body });

  assert.equal(w.__replyAllCard, "second", "j should move the message cursor to the next card");
}

// Cmd+K toggles the command palette; Escape closes it. (The palette getting stuck
// open/closed has regressed before.)
{
  const w = load(listFixture(), "#inbox");

  const open = press(w, "k", { target: w.document.body, metaKey: true });
  assert.equal(open.defaultPrevented, true, "Cmd+K should be claimed");
  assert.equal(w.CMDK.palette.isOpen(), true, "Cmd+K opens the palette");

  const close = press(w, "Escape", { target: w.document.body });
  assert.equal(close.defaultPrevented, true, "Escape should be claimed while the palette is open");
  assert.equal(w.CMDK.palette.isOpen(), false, "Escape closes the palette");
}

// Regression guard for the exact crash we just hit: a keydown whose target is the
// document (focus on nothing) must not throw "el.getAttribute is not a function",
// and the shortcut must still work.
{
  const w = load(listFixture(), "#inbox");
  wireList(w);

  let threw = null;
  try {
    const event = new w.KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true });
    w.document.dispatchEvent(event); // target is the document, not an Element
  } catch (e) {
    threw = e;
  }

  assert.equal(threw, null, "a keydown targeted at the document must not throw");
  assert.equal(rows(w)[1].classList.contains("cmdk-cursor"), true, "the shortcut still runs after a non-Element target");
}

console.log("hotkey integration tests passed");
