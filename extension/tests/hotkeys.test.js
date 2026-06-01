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

function collapsedThreadFixture() {
  return `
    <div role="main">
      <div role="listitem" data-card="first">
        <div class="gE">first header</div>
        <button class="ams">Reply all</button>
      </div>
      <div role="listitem" data-card="second">
        <div class="gE">second header</div>
        <div class="a3s" data-message-id="m2">second body</div>
        <button class="ams">Reply all</button>
      </div>
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

// Thread navigation only moves the cursor; Enter on a collapsed focused message
// opens that message.
{
  const w = load(collapsedThreadFixture(), "#inbox/" + ID);
  const headerClicks = [];
  for (const card of w.document.querySelectorAll('[role="listitem"]')) {
    card.querySelector(".gE").addEventListener("click", () => {
      headerClicks.push(card.getAttribute("data-card"));
    });
  }

  press(w, "k", { target: w.document.body });
  assert.deepEqual(headerClicks, [], "moving to a message must not expand or collapse it");
  press(w, "Enter", { target: w.document.body });

  assert.deepEqual(headerClicks, ["first"], "Enter should expand/collapse the focused message card");
}

// Enter on an expanded focused message starts Reply All on that particular card.
{
  const w = load(threadFixture(), "#inbox/" + ID);
  const replyAllCards = [];
  const headerClicks = [];
  for (const card of w.document.querySelectorAll('[role="listitem"]')) {
    card.querySelector(".ams").addEventListener("click", () => {
      replyAllCards.push(card.getAttribute("data-card"));
    });
    card.querySelector(".gE").addEventListener("click", () => {
      headerClicks.push(card.getAttribute("data-card"));
    });
  }

  press(w, "k", { target: w.document.body });
  press(w, "Enter", { target: w.document.body });

  assert.deepEqual(replyAllCards, ["first"], "Enter should reply-all on the focused expanded message card");
  assert.deepEqual(headerClicks, [], "Enter should not collapse an already-expanded focused message");
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

// Real Gmail puts the inline Reply / Reply all / Forward controls at the BOTTOM of
// the conversation, OUTSIDE the focused message card. Reply-all clicks the inline
// "Reply all" when the thread has other recipients; on a two-person thread Gmail
// offers no "Reply all" and a plain "Reply" already reaches the only other person.
// Reply-all must NEVER open the response-type caret menu (that menu popped over the
// compose box and fought with typing).
const THREAD_MULTI_RECIPIENT = `
  <div role="main">
    <div role="listitem" data-card="only">
      <div class="gE">header</div>
      <div class="a3s" data-message-id="m1">body</div>
    </div>
    <span class="ams bkH">Reply</span>
    <span class="ams">Reply all</span>
    <span class="ams bkG">Forward</span>
  </div>`;

const THREAD_TWO_PERSON = `
  <div role="main">
    <div role="listitem" data-card="only">
      <div class="gE">header</div>
      <div class="a3s" data-message-id="m1">body</div>
    </div>
    <span class="ams bkH">Reply</span>
    <span class="ams bkG">Forward</span>
  </div>`;

function wireInlineActions(w, opts = {}) {
  for (const link of w.document.querySelectorAll(".ams")) {
    link.addEventListener("click", () => {
      w.__clickedAction = (link.textContent || "").trim();
      if (opts.openCompose === false || w.document.querySelector('[aria-label="Message Body"]')) return;
      const surface = w.document.createElement("div");
      surface.setAttribute("data-compose-surface", "true");
      surface.innerHTML = '<div aria-label="Message Body" contenteditable="true" role="textbox"></div>';
      if (opts.withBlockingMenu) {
        const menu = w.document.createElement("div");
        menu.setAttribute("role", "menu");
        menu.innerHTML =
          '<div role="menuitem">Reply</div>' +
          '<div role="menuitem">Forward</div>' +
          '<div role="menuitem">Edit subject</div>' +
          '<div role="menuitem">Pop out reply</div>';
        surface.appendChild(menu);
      }
      const body = surface.querySelector('[aria-label="Message Body"]');
      body.addEventListener("focus", () => {
        w.__replyBodyFocused = true;
      });
      body.addEventListener("click", () => {
        const menu = w.document.querySelector('[role="menu"]');
        if (menu) menu.remove();
      });
      w.document.querySelector('[role="main"]').appendChild(surface);
    });
  }
}

// Enter on a multi-recipient thread clicks the inline "Reply all" in one step (no
// response-type menu).
{
  const w = load(THREAD_MULTI_RECIPIENT, "#inbox/" + ID);
  wireInlineActions(w);

  press(w, "Enter", { target: w.document.body });

  assert.equal(w.__clickedAction, "Reply all", "Enter should click the inline Reply all on a multi-recipient thread");
}

// After opening Reply all, focus must land in the compose body and any transient
// reply dropdown should be dismissed before the user starts typing.
{
  const w = load(THREAD_MULTI_RECIPIENT, "#inbox/" + ID);
  wireInlineActions(w, { withBlockingMenu: true });

  press(w, "Enter", { target: w.document.body });

  const body = w.document.querySelector('[aria-label="Message Body"]');
  assert.equal(w.__clickedAction, "Reply all", "Enter should click the inline Reply all");
  assert.equal(w.__replyBodyFocused, true, "Reply all should focus the message body");
  assert.equal(w.document.activeElement, body, "the message body should receive keyboard focus");
  assert.equal(w.document.querySelector('[role="menu"]'), null, "reply dropdown menu should not remain open over the composer");
}

// Enter on a two-person thread (no Reply all offered) opens a plain reply, which
// already goes to the only other person. No menu.
{
  const w = load(THREAD_TWO_PERSON, "#inbox/" + ID);
  wireInlineActions(w);

  press(w, "Enter", { target: w.document.body });

  assert.equal(w.__clickedAction, "Reply", "Enter opens a plain reply when there is no Reply all (it is the reply-all)");
}

// The "a" key reply-alls the conversation the same way.
{
  const w = load(THREAD_MULTI_RECIPIENT, "#inbox/" + ID);
  wireInlineActions(w);

  press(w, "a", { target: w.document.body });

  assert.equal(w.__clickedAction, "Reply all", "the a key should click the inline Reply all");
}

// r is always a plain reply, even when Reply all is available, so Enter (all) and
// r (single) stay distinct.
{
  const w = load(THREAD_MULTI_RECIPIENT, "#inbox/" + ID);
  wireInlineActions(w);

  press(w, "r", { target: w.document.body });

  assert.equal(w.__clickedAction, "Reply", "r should always open a plain reply");
}

// j moves the thread's message cursor DOWN across cards, without expanding the
// target. The cursor starts on the latest card, so we step up with k first, then
// back down with j to prove downward movement.
{
  const threeCards = `
    <div role="main">
      <div role="listitem" data-card="a"><div class="gE">a</div><div class="a3s" data-message-id="m1">a</div></div>
      <div role="listitem" data-card="b"><div class="gE">b</div><div class="a3s" data-message-id="m2">b</div></div>
      <div role="listitem" data-card="c"><div class="gE">c</div><div class="a3s" data-message-id="m3">c</div></div>
    </div>`;
  const w = load(threeCards, "#inbox/" + ID);
  const headerClicks = [];
  for (const card of w.document.querySelectorAll('[role="listitem"]')) {
    card.querySelector(".gE").addEventListener("click", () => {
      headerClicks.push(card.getAttribute("data-card"));
    });
  }

  press(w, "k", { target: w.document.body }); // c -> b
  press(w, "k", { target: w.document.body }); // b -> a
  press(w, "j", { target: w.document.body }); // a -> b

  assert.deepEqual(headerClicks, [], "j/k movement must not click message headers");
  assert.equal(w.document.querySelector('[data-card="b"]').classList.contains("cmdk-msg-cursor"), true, "j should move the message cursor down to the next card");
}

// Arrows move the indicator between cards; at the first/last card they fall back
// to scrolling the reading pane. Movement does not expand the focused card.
{
  const w = load(threadFixture(), "#inbox/" + ID);
  const main = w.document.querySelector('[role="main"]');
  main.style.overflowY = "scroll";
  Object.defineProperty(main, "scrollHeight", { value: 5000, configurable: true });
  Object.defineProperty(main, "clientHeight", { value: 800, configurable: true });
  const scrolled = [];
  main.scrollBy = (opts) => scrolled.push(opts.top);
  const cardEls = Array.from(w.document.querySelectorAll('[role="listitem"]'));
  const headerClicks = [];
  for (const card of cardEls) {
    card.querySelector(".gE").addEventListener("click", () => {
      headerClicks.push(card.getAttribute("data-card"));
    });
  }

  // Cursor starts on the latest (second) card; ArrowUp moves the indicator up to the first.
  const up = press(w, "ArrowUp", { target: w.document.body });
  assert.equal(up.defaultPrevented, true, "ArrowUp is claimed in thread view");
  assert.equal(cardEls[0].classList.contains("cmdk-msg-cursor"), true, "ArrowUp moves the indicator to the first card");
  assert.deepEqual(headerClicks, [], "ArrowUp must not expand/collapse while moving the cursor");
  assert.equal(scrolled.length, 0, "moving the indicator between messages must not scroll");

  // Already on the first card: ArrowUp has nowhere to go, so it scrolls the pane up.
  press(w, "ArrowUp", { target: w.document.body });
  assert.ok(scrolled.length === 1 && scrolled[0] < 0, "ArrowUp at the first card falls back to scrolling up");

  // PageDown always scrolls the reading pane (a larger step).
  const pageDown = press(w, "PageDown", { target: w.document.body });
  assert.equal(pageDown.defaultPrevented, true, "PageDown is claimed in thread view");
  assert.ok(scrolled.length === 2 && scrolled[1] > 0, "PageDown scrolls the reading pane down");
}

// Arrow traversal should not stop on the global Expand all button; that action
// has its own ":" shortcut.
{
  const w = load(threadFixture(), "#inbox/" + ID);
  const main = w.document.querySelector('[role="main"]');
  main.style.overflowY = "scroll";
  Object.defineProperty(main, "scrollHeight", { value: 5000, configurable: true });
  Object.defineProperty(main, "clientHeight", { value: 800, configurable: true });
  const scrolled = [];
  main.scrollBy = (opts) => scrolled.push(opts.top);
  const expandAll = w.document.querySelector('[aria-label="Expand all"]');

  press(w, "ArrowDown", { target: w.document.body });

  assert.equal(expandAll.classList.contains("cmdk-msg-cursor"), false, "ArrowDown should not focus the global Expand all control");
  assert.ok(scrolled.length === 1 && scrolled[0] > 0, "ArrowDown at the latest message should scroll instead");
}

// Arrow navigation includes explicit expansion opportunities between message
// cards; j/k still skip those controls and move only between emails.
{
  const mixedThread = `
    <div role="main">
      <div role="listitem" data-card="a"><div class="gE">a</div><div class="a3s" data-message-id="m1">a</div></div>
      <div role="button" aria-expanded="false" data-expander="more">3 collapsed messages</div>
      <div role="listitem" data-card="b"><div class="gE">b</div><div class="a3s" data-message-id="m2">b</div></div>
    </div>`;
  const w = load(mixedThread, "#inbox/" + ID);
  const expander = w.document.querySelector('[data-expander="more"]');
  expander.addEventListener("click", () => {
    w.__expandedOpportunity = true;
  });

  press(w, "ArrowUp", { target: w.document.body });
  assert.equal(expander.classList.contains("cmdk-msg-cursor"), true, "ArrowUp should stop on an expansion opportunity");

  press(w, "Enter", { target: w.document.body });
  assert.equal(w.__expandedOpportunity, true, "Enter should activate the focused expansion opportunity");

  press(w, "j", { target: w.document.body });
  assert.equal(w.document.querySelector('[data-card="b"]').classList.contains("cmdk-msg-cursor"), true, "j should move to the next email, skipping expansion controls");
}

// A single-message thread (a long newsletter): there's no other card to move to, so
// arrows scroll the reading pane instead of moving the indicator.
{
  const oneCard = `
    <div role="main">
      <div role="listitem" data-card="only"><div class="gE">h</div><div class="a3s" data-message-id="m1">long body</div></div>
    </div>`;
  const w = load(oneCard, "#inbox/" + ID);
  const main = w.document.querySelector('[role="main"]');
  main.style.overflowY = "scroll";
  Object.defineProperty(main, "scrollHeight", { value: 9000, configurable: true });
  Object.defineProperty(main, "clientHeight", { value: 800, configurable: true });
  const scrolled = [];
  main.scrollBy = (opts) => scrolled.push(opts.top);

  const down = press(w, "ArrowDown", { target: w.document.body });
  assert.equal(down.defaultPrevented, true, "ArrowDown is claimed in a single-message thread");
  assert.ok(scrolled.length === 1 && scrolled[0] > 0, "ArrowDown scrolls a long single message (nothing to navigate to)");
  assert.equal(
    Array.from(w.document.querySelectorAll('[role="listitem"]')).some((c) => c.classList.contains("cmdk-msg-cursor")),
    false,
    "a single-message thread has no other card to move the indicator to"
  );
}

// k walks the message cursor UP across cards (3-message thread): cursor starts on
// the latest message, k steps to the middle one, then the first.
{
  const threeCards = `
    <div role="main">
      <div role="listitem" data-card="a"><div class="gE">a</div><div class="a3s" data-message-id="m1">a</div></div>
      <div role="listitem" data-card="b"><div class="gE">b</div><div class="a3s" data-message-id="m2">b</div></div>
      <div role="listitem" data-card="c"><div class="gE">c</div><div class="a3s" data-message-id="m3">c</div></div>
    </div>`;
  const w = load(threeCards, "#inbox/" + ID);

  press(w, "k", { target: w.document.body }); // c -> b
  press(w, "k", { target: w.document.body }); // b -> a

  assert.equal(w.document.querySelector('[data-card="a"]').classList.contains("cmdk-msg-cursor"), true, "k should walk the message cursor up to the first card");
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
