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

function listFixtureWithSearchValue(value) {
  return listFixture().replace('<input aria-label="Search mail" name="q" />', `<input aria-label="Search mail" name="q" value="${value}" />`);
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
  w.InboxKeys.hotkeys.install();
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
  assert.equal(rows(w)[1].classList.contains("inboxkeys-cursor"), true, "j should move the list cursor");
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
  assert.equal(rows(w).some((row) => row.classList.contains("inboxkeys-cursor")), false, "search typing should not move the cursor");

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

// Regression: submitting a search must un-stick "search editing" so list shortcuts
// (e/x/j/k) work even while Gmail keeps the search box focused over the results.
// searchEditing used to only clear on Enter/Escape-in-box or a blur timeout, so
// submitting via a suggestion click (or re-focusing the box) left it stuck true and
// every list key was swallowed — the "e stops archiving after a search" bug. A
// hashchange (the search submit) now clears it.
{
  const w = load(listFixture(), "#search/sean");
  wireList(w);
  const search = w.document.querySelector('input[name="q"]');
  // User opened the search box and is composing a query: editing armed + focused.
  w.InboxKeys.hotkeys.armSearchEditing();
  search.focus();

  // While actively typing, x must stay typeable (not hijack the list).
  const whileTyping = press(w, "x", { target: search });
  assert.equal(whileTyping.defaultPrevented, false, "while composing a query, x stays typeable in the search box");
  assert.equal(rows(w).some((r) => r.querySelector('[role="checkbox"]').getAttribute("aria-checked") === "true"), false, "composing a query must not select a row");

  // Submit the search: the hash changes. Editing mode must clear even though Gmail
  // leaves the search box focused on the results.
  w.location.hash = "#search/sean%20chiu";
  w.dispatchEvent(new w.Event("hashchange"));

  const afterSubmit = press(w, "x", { target: search });
  assert.equal(afterSubmit.defaultPrevented, true, "after submit, x drives the list even with the search box still focused");
  assert.equal(rows(w)[0].querySelector('[role="checkbox"]').getAttribute("aria-checked"), "true", "x selects the cursor row once the search is submitted");

  // e archives the same way (same gate as x): it must reach the list too.
  const archiveEvent = press(w, "e", { target: search });
  assert.equal(archiveEvent.defaultPrevented, true, "e (archive) is claimed in submitted search results with the box focused");
}

// Regression: e (archive) in search/all-mail on a conversation that ISN'T in the
// Inbox. Search results have no per-row Archive button, so archive() selects the
// row then drives the toolbar — but Gmail disables that toolbar Archive when the
// mail isn't in the Inbox (it offers "Move to Inbox" instead). The old code
// clicked the dead button: the row got selected and nothing happened, which is
// exactly the reported "e selects but doesn't archive when search is on." Now a
// disabled Archive drops the selection and warns; an in-Inbox row in the same
// view still archives through the enabled toolbar button.
{
  const searchFixture = (archiveDisabled) => `
    <input aria-label="Search mail" name="q" />
    <div role="main">
      <div gh="tl"><table><tbody>
        <tr class="zA" data-row="one">
          <td><div role="checkbox" aria-checked="false"></div></td>
          <td><span class="bog">one</span></td>
        </tr>
        <tr class="zA" data-row="two">
          <td><div role="checkbox" aria-checked="false"></div></td>
          <td><span class="bog">two</span></td>
        </tr>
      </tbody></table></div>
    </div>
    <div gh="tm">
      <div role="button" aria-label="Archive"${archiveDisabled ? ' aria-disabled="true"' : ""}>Archive</div>
    </div>`;

  const wire = (w) => {
    for (const row of rows(w)) {
      row.querySelector('[role="checkbox"]').addEventListener("click", (e) => {
        const cb = e.currentTarget;
        cb.setAttribute("aria-checked", cb.getAttribute("aria-checked") === "true" ? "false" : "true");
      });
    }
    w.document.querySelector('[gh="tm"] [aria-label="Archive"]').addEventListener("click", () => {
      w.__toolbarArchived = true;
    });
    // jsdom has no requestAnimationFrame (toast.js uses it), so spy instead of
    // letting the real toast run. listnav reads InboxKeys.toast dynamically.
    w.InboxKeys.toast = (msg) => { w.__lastToast = msg; };
  };

  // Not in Inbox: the toolbar Archive is disabled.
  {
    const w = load(searchFixture(true), "#search/is%3Aunread");
    wire(w);
    const ev = press(w, "e", { target: w.document.body });
    assert.equal(ev.defaultPrevented, true, "e is claimed in search results");
    assert.notEqual(w.__toolbarArchived, true, "a disabled Archive button must not be clicked");
    assert.equal(
      rows(w)[0].querySelector('[role="checkbox"]').getAttribute("aria-checked"),
      "false",
      "the selection we made is dropped when Archive isn't available"
    );
    assert.match(w.__lastToast || "", /Inbox/, "the user is told why nothing was archived");
  }

  // In Inbox (same search view): the toolbar Archive is enabled and must fire.
  {
    const w = load(searchFixture(false), "#search/is%3Aunread");
    wire(w);
    const ev = press(w, "e", { target: w.document.body });
    assert.equal(ev.defaultPrevented, true, "e is claimed in search results");
    assert.equal(w.__toolbarArchived, true, "an enabled toolbar Archive still archives from search");
    assert.equal(w.__lastToast, undefined, "no warning when the archive actually happens");
  }
}

// Regression: archive a single cursor row whose ONLY enabled Archive is the
// per-row hover button. Gmail keeps that button in the DOM but sized 0x0 until
// the row is hovered, and in a Priority ("Important first") inbox the toolbar
// Archive is DISABLED even for in-Inbox mail. We navigate by keyboard and never
// hover, so the old code saw the per-row button as invisible and clicked the
// dead toolbar button — the row got selected and nothing happened ("e selects
// but doesn't archive, even in the inbox"). The fix hovers to reveal the per-row
// Archive and clicks it, never touching the disabled toolbar button.
{
  // Per-row Archive is Gmail's real shape: <li data-tooltip="Archive"> with no
  // role="button". The toolbar Archive is a disabled [role="button"].
  const w = load(`
    <div role="main">
      <div gh="tl"><table><tbody>
        <tr class="zA" data-row="one">
          <td><div role="checkbox" aria-checked="false"></div></td>
          <td><span class="bog">one</span></td>
          <td><ul><li data-tooltip="Archive">Archive</li></ul></td>
        </tr>
      </tbody></table></div>
    </div>
    <div gh="tm"><div role="button" aria-label="Archive" aria-disabled="true">Archive</div></div>
  `, "#inbox");

  const row = rows(w)[0];
  const perRow = row.querySelector('li[data-tooltip="Archive"]');
  const toolbar = w.document.querySelector('[gh="tm"] [aria-label="Archive"]');

  // Mimic Gmail: the per-row Archive is 0x0 (invisible) until the row is hovered.
  let revealed = false;
  perRow.getBoundingClientRect = () =>
    revealed
      ? { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0, toJSON() {} }
      : { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
  row.addEventListener("mouseover", () => { revealed = true; });

  let perRowClicked = false;
  let toolbarClicked = false;
  perRow.addEventListener("click", () => { perRowClicked = true; });
  toolbar.addEventListener("click", () => { toolbarClicked = true; });
  row.querySelector('[role="checkbox"]').addEventListener("click", (e) => {
    const cb = e.currentTarget;
    cb.setAttribute("aria-checked", cb.getAttribute("aria-checked") === "true" ? "false" : "true");
  });

  assert.equal(w.InboxKeys.gmail.isVisible(perRow), false, "per-row Archive starts hidden (0x0) before hover");

  const ev = press(w, "e", { target: w.document.body });
  assert.equal(ev.defaultPrevented, true, "e is claimed in the inbox list");
  assert.equal(perRowClicked, true, "archive hovers the row to reveal its per-row Archive and clicks it");
  assert.equal(toolbarClicked, false, "the disabled toolbar Archive is never clicked");
  assert.equal(
    row.querySelector('[role="checkbox"]').getAttribute("aria-checked"),
    "false",
    "per-row archive doesn't strand a selection"
  );
}

// Bulk archive when the toolbar Archive is disabled (Priority Inbox): fall back
// to archiving each selected row through its own per-row hover button.
{
  const w = load(`
    <div role="main">
      <div gh="tl"><table><tbody>
        <tr class="zA" data-row="one">
          <td><div role="checkbox" aria-checked="false"></div></td>
          <td><span class="bog">one</span></td>
          <td><ul><li data-tooltip="Archive">Archive</li></ul></td>
        </tr>
        <tr class="zA" data-row="two">
          <td><div role="checkbox" aria-checked="false"></div></td>
          <td><span class="bog">two</span></td>
          <td><ul><li data-tooltip="Archive">Archive</li></ul></td>
        </tr>
      </tbody></table></div>
    </div>
    <div gh="tm"><div role="button" aria-label="Archive" aria-disabled="true">Archive</div></div>
  `, "#inbox");

  const archived = [];
  for (const row of rows(w)) {
    row.querySelector('[role="checkbox"]').addEventListener("click", (e) => {
      const cb = e.currentTarget;
      cb.setAttribute("aria-checked", cb.getAttribute("aria-checked") === "true" ? "false" : "true");
    });
    row.querySelector('li[data-tooltip="Archive"]').addEventListener("click", () => {
      archived.push(row.getAttribute("data-row"));
    });
  }
  let toolbarClicked = false;
  w.document.querySelector('[gh="tm"] [aria-label="Archive"]').addEventListener("click", () => { toolbarClicked = true; });

  press(w, "x", { target: w.document.body }); // select row one
  press(w, "j", { target: w.document.body }); // move to row two
  press(w, "x", { target: w.document.body }); // select row two
  assert.equal(w.InboxKeys.listnav.selectedRows().length, 2, "two rows selected");

  press(w, "e", { target: w.document.body });
  assert.equal(toolbarClicked, false, "the disabled toolbar Archive isn't used for bulk");
  assert.deepEqual(archived.sort(), ["one", "two"], "each selected row is archived via its per-row button");
}

// "Archive here": e targets the row the mouse is over, not a stale top-of-list
// cursor. Hovering the second row makes it the target, so e archives the email
// you're actually looking at (whether you got there by mouse or by j/k).
{
  const w = load(`
    <div role="main">
      <div gh="tl"><table><tbody>
        <tr class="zA" data-row="one">
          <td><div role="checkbox" aria-checked="false"></div></td>
          <td><span class="bog">one</span></td>
          <td><ul><li data-tooltip="Archive">Archive</li></ul></td>
        </tr>
        <tr class="zA" data-row="two">
          <td><div role="checkbox" aria-checked="false"></div></td>
          <td><span class="bog">two</span></td>
          <td><ul><li data-tooltip="Archive">Archive</li></ul></td>
        </tr>
      </tbody></table></div>
    </div>
  `, "#inbox");

  const archived = [];
  for (const row of rows(w)) {
    row.querySelector('li[data-tooltip="Archive"]').addEventListener("click", () => {
      archived.push(row.getAttribute("data-row"));
    });
  }

  // The default cursor is the top row, but the mouse is over the SECOND row.
  rows(w)[1].dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true }));
  press(w, "e", { target: w.document.body });
  assert.deepEqual(archived, ["two"], "e archives the hovered row, not the default top row");

  // After a keyboard move, the keyboard cursor wins again (most-recent pointer).
  archived.length = 0;
  press(w, "k", { target: w.document.body }); // move cursor up to the top row
  press(w, "e", { target: w.document.body });
  assert.deepEqual(archived, ["one"], "after j/k the keyboard cursor takes the target back");
}

// Regression: a standing selection must be clearable even when Gmail keeps the
// search box focused and search-editing is armed. Escape used to just blur the box
// and leave the row selected ("I selected the convo but cannot clear it"); a second
// Escape was needed. A selection now overrides search-editing so Escape clears it.
{
  const w = load(listFixture(), "#search/is%3Aunread");
  wireList(w);
  const search = w.document.querySelector('input[name="q"]');
  const cb0 = rows(w)[0].querySelector('[role="checkbox"]');

  press(w, "x", { target: w.document.body });
  assert.equal(cb0.getAttribute("aria-checked"), "true", "x selects the cursor row");

  // User is focused in the search box with editing armed (e.g. they clicked it).
  w.InboxKeys.hotkeys.armSearchEditing();
  search.focus();

  const esc = press(w, "Escape", { target: search });
  assert.equal(esc.defaultPrevented, true, "Escape is claimed to clear the selection, not just blur the search box");
  assert.equal(cb0.getAttribute("aria-checked"), "false", "Escape clears the standing selection on the first press");
}

// And x must still deselect a selected row even with the search box focused/armed.
{
  const w = load(listFixture(), "#search/is%3Aunread");
  wireList(w);
  const search = w.document.querySelector('input[name="q"]');
  const cb0 = rows(w)[0].querySelector('[role="checkbox"]');

  press(w, "x", { target: w.document.body });
  assert.equal(cb0.getAttribute("aria-checked"), "true", "x selects the cursor row");
  w.InboxKeys.hotkeys.armSearchEditing();
  search.focus();

  const deselect = press(w, "x", { target: search });
  assert.equal(deselect.defaultPrevented, true, "x is claimed to toggle selection with the search box focused");
  assert.equal(cb0.getAttribute("aria-checked"), "false", "x deselects the row while a selection exists");

  // Once nothing is selected, x is back to typing mode (must not be hijacked).
  const typed = press(w, "x", { target: search });
  assert.equal(typed.defaultPrevented, false, "with no selection, x stays typeable in the search box");
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

// g g and Shift+G should move both the Gmail list scroll position and our
// keyboard cursor. Otherwise the next j/k/e/Enter jumps back to a stale row.
{
  const w = load(listFixture(), "#inbox");
  wireList(w);
  const main = w.document.querySelector('[role="main"]');
  main.style.overflowY = "scroll";
  Object.defineProperty(main, "scrollHeight", { value: 5000, configurable: true });
  Object.defineProperty(main, "clientHeight", { value: 500, configurable: true });

  const bottom = press(w, "G", { target: w.document.body, shiftKey: true });
  assert.equal(bottom.defaultPrevented, true, "Shift+G should be claimed in the list");
  assert.equal(main.scrollTop, 5000, "Shift+G should scroll the list container to the bottom");
  assert.equal(rows(w)[1].classList.contains("inboxkeys-cursor"), true, "Shift+G should move the cursor to the last rendered row");
  assert.equal(w.__lastScrollIntoViewOptions.block, "end", "bottom jump should align the cursor at the bottom edge");

  press(w, "g", { target: w.document.body });
  const top = press(w, "g", { target: w.document.body });
  assert.equal(top.defaultPrevented, true, "g g should be claimed in the list");
  assert.equal(main.scrollTop, 0, "g g should scroll the list container to the top");
  assert.equal(rows(w)[0].classList.contains("inboxkeys-cursor"), true, "g g should move the cursor to the first rendered row");
  assert.equal(w.__lastScrollIntoViewOptions.block, "start", "top jump should align the cursor at the top edge");
}

// Escape back from a thread must restore the list position: same cursor row,
// same scroll offset. Gmail re-renders the list at the TOP after the hash
// navigates back, and the old blanket reset() on every hashchange threw the
// cursor away too — the "Escape sends me back to the top" bug.
{
  const w = load(listFixture(), "#inbox");
  wireList(w);
  // Sync the hashchange tracker to the test's starting hash (load() sets the
  // hash without firing the event, which jsdom doesn't do for us).
  w.dispatchEvent(new w.Event("hashchange"));
  const main = w.document.querySelector('[role="main"]');
  main.style.overflowY = "scroll";
  Object.defineProperty(main, "scrollHeight", { value: 5000, configurable: true });
  Object.defineProperty(main, "clientHeight", { value: 500, configurable: true });

  // Cursor on the second row, scrolled partway down the list.
  press(w, "j", { target: w.document.body });
  assert.equal(rows(w)[1].classList.contains("inboxkeys-cursor"), true, "j moves the cursor to row two");
  main.scrollTop = 1234;

  // Open a thread: the hash dives and Gmail renders the conversation.
  w.location.hash = "#inbox/" + ID;
  w.dispatchEvent(new w.Event("hashchange"));
  const msg = w.document.createElement("div");
  msg.setAttribute("data-message-id", "m1");
  main.appendChild(msg);

  // Escape goes back; Gmail tears down the thread and re-renders the list at
  // the top.
  const esc = press(w, "Escape", { target: w.document.body });
  assert.equal(esc.defaultPrevented, true, "Escape is claimed in thread view");
  assert.equal(w.location.hash, "#inbox", "Escape returns to the parent list");
  msg.remove();
  main.scrollTop = 0; // what Gmail does to the restored list
  w.dispatchEvent(new w.Event("hashchange"));

  assert.equal(main.scrollTop, 1234, "the list scroll offset is restored after Escape");
  assert.equal(rows(w)[1].classList.contains("inboxkeys-cursor"), true, "the cursor is restored to the row it was on");

  // A later j continues from the restored row, not from the top.
  press(w, "j", { target: w.document.body });
  assert.equal(rows(w)[1].classList.contains("inboxkeys-cursor"), true, "j continues from the restored cursor (already on the last row)");
}

// The restore is re-pinned on timers (120/320/600ms) because Gmail keeps
// re-rendering the returned list and snaps the scroll back to the top a beat
// later. Those re-pins must survive a PASSIVE mouseover: when the list rebuilds
// under a still mouse pointer, Gmail fires mouseover on the new rows, which must
// NOT be read as "the user moved on" and abort the re-pin. (Regression: the
// guard used evSeq, which mouseover bumps, so the re-pins silently bailed and
// the cursor/scroll jumped to the top — the reported focus-loss bug.)
{
  const w = load(listFixture(), "#inbox");
  wireList(w);
  w.dispatchEvent(new w.Event("hashchange"));
  const main = w.document.querySelector('[role="main"]');
  main.style.overflowY = "scroll";
  Object.defineProperty(main, "scrollHeight", { value: 5000, configurable: true });
  Object.defineProperty(main, "clientHeight", { value: 500, configurable: true });

  press(w, "j", { target: w.document.body });
  main.scrollTop = 1234;
  w.location.hash = "#inbox/" + ID;
  w.dispatchEvent(new w.Event("hashchange"));
  const msg = w.document.createElement("div");
  msg.setAttribute("data-message-id", "m1");
  main.appendChild(msg);

  press(w, "Escape", { target: w.document.body });
  assert.equal(w.location.hash, "#inbox", "Escape returns to the parent list");
  msg.remove();

  // Capture the re-pin timers so we can fire them after simulating Gmail's churn.
  const repins = [];
  const realSetTimeout = w.setTimeout;
  w.setTimeout = (fn, ms) => { repins.push(fn); return 0; };

  main.scrollTop = 0; // Gmail's first re-render snaps to the top
  w.dispatchEvent(new w.Event("hashchange")); // synchronous apply restores once
  assert.equal(main.scrollTop, 1234, "the immediate restore lands the scroll");

  // Gmail re-renders again and snaps to the top; the pointer is resting over the
  // list, so a mouseover fires on a rebuilt row WITHOUT the user touching anything.
  main.scrollTop = 0;
  rows(w)[0].dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true }));

  // Fire the queued re-pins. They must re-apply despite the passive mouseover.
  repins.forEach((fn) => fn());
  w.setTimeout = realSetTimeout;

  assert.equal(main.scrollTop, 1234, "a passive mouseover must not abort the re-pin (scroll stays restored)");
  assert.equal(rows(w)[1].classList.contains("inboxkeys-cursor"), true, "the cursor row survives the passive mouseover");
}

// The flip side: a real keyboard move during the restore window DOES take over,
// so the re-pins stop fighting the user instead of yanking them back.
{
  const w = load(listFixture(), "#inbox");
  wireList(w);
  w.dispatchEvent(new w.Event("hashchange"));
  const main = w.document.querySelector('[role="main"]');
  main.style.overflowY = "scroll";
  Object.defineProperty(main, "scrollHeight", { value: 5000, configurable: true });
  Object.defineProperty(main, "clientHeight", { value: 500, configurable: true });

  press(w, "j", { target: w.document.body });
  main.scrollTop = 1234;
  w.location.hash = "#inbox/" + ID;
  w.dispatchEvent(new w.Event("hashchange"));
  const msg = w.document.createElement("div");
  msg.setAttribute("data-message-id", "m1");
  main.appendChild(msg);
  press(w, "Escape", { target: w.document.body });
  msg.remove();

  const repins = [];
  const realSetTimeout = w.setTimeout;
  w.setTimeout = (fn, ms) => { repins.push(fn); return 0; };
  w.dispatchEvent(new w.Event("hashchange"));

  // User keeps navigating with the keyboard, then scrolls away.
  press(w, "k", { target: w.document.body });
  main.scrollTop = 4321;
  repins.forEach((fn) => fn());
  w.setTimeout = realSetTimeout;

  assert.equal(main.scrollTop, 4321, "a keyboard move cancels the re-pin so it doesn't yank the user back");
}

// Real Gmail can rebuild the list before the thread hashchange handler can read
// the old scroll position. The Enter handler must snapshot the list before
// clicking the row, otherwise Escape restores the already-reset top position.
{
  const w = load(listFixture(), "#inbox");
  w.dispatchEvent(new w.Event("hashchange"));
  const main = w.document.querySelector('[role="main"]');
  main.style.overflowY = "scroll";
  Object.defineProperty(main, "scrollHeight", { value: 5000, configurable: true });
  Object.defineProperty(main, "clientHeight", { value: 500, configurable: true });

  press(w, "j", { target: w.document.body });
  main.scrollTop = 1234;

  const listHtml = main.querySelector('[gh="tl"]').outerHTML;
  rows(w)[1].querySelector(".bog").addEventListener("click", () => {
    main.querySelector('[gh="tl"]').remove();
    main.scrollTop = 0;
    w.location.hash = "#inbox/" + ID;
    const msg = w.document.createElement("div");
    msg.setAttribute("data-message-id", "m1");
    main.appendChild(msg);
    w.dispatchEvent(new w.Event("hashchange"));
  });

  const openEvent = press(w, "Enter", { target: w.document.body });
  assert.equal(openEvent.defaultPrevented, true, "Enter should be claimed in list view");
  assert.equal(w.location.hash, "#inbox/" + ID, "Enter opens the thread");

  const esc = press(w, "Escape", { target: w.document.body });
  assert.equal(esc.defaultPrevented, true, "Escape should be claimed in thread view");
  assert.equal(w.location.hash, "#inbox", "Escape returns to the list");
  main.innerHTML = listHtml;
  main.scrollTop = 0;
  w.dispatchEvent(new w.Event("hashchange"));

  assert.equal(main.scrollTop, 1234, "Escape should restore the pre-click list scroll offset");
  assert.equal(rows(w)[1].classList.contains("inboxkeys-cursor"), true, "Escape should restore the pre-click cursor row");
}

// Shift+N / Shift+P page the message list via Gmail's Older/Newer pager. Works
// from the list, and from search results where Gmail keeps the search box focused.
{
  const pager = `
    <input aria-label="Search mail" name="q" />
    <div role="main">
      <div gh="tl"><table><tbody>
        <tr class="zA" data-row="one"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">one</span></td></tr>
        <tr class="zA" data-row="two"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">two</span></td></tr>
      </tbody></table></div>
    </div>
    <div gh="tm">
      <div role="button" aria-label="Newer">Newer</div>
      <div role="button" aria-label="Older">Older</div>
    </div>`;

  // From the list (nothing editable focused).
  {
    const w = load(pager, "#inbox");
    let older = false, newer = false;
    w.document.querySelector('[aria-label="Older"]').addEventListener("click", () => { older = true; });
    w.document.querySelector('[aria-label="Newer"]').addEventListener("click", () => { newer = true; });

    const n = press(w, "N", { target: w.document.body, shiftKey: true });
    assert.equal(n.defaultPrevented, true, "Shift+N is claimed in the list");
    assert.equal(older, true, "Shift+N pages forward by clicking Older");

    const p = press(w, "P", { target: w.document.body, shiftKey: true });
    assert.equal(p.defaultPrevented, true, "Shift+P is claimed in the list");
    assert.equal(newer, true, "Shift+P pages back by clicking Newer");
  }

  // From search results with the search box focused (searchEditing armed): paging
  // must still work, like Tab, since it sits before the editable guard.
  {
    const w = load(pager, "#search/promo");
    let older = false;
    w.document.querySelector('[aria-label="Older"]').addEventListener("click", () => { older = true; });
    const search = w.document.querySelector('input[name="q"]');
    w.InboxKeys.hotkeys.armSearchEditing();
    search.focus();

    const n = press(w, "N", { target: search, shiftKey: true });
    assert.equal(n.defaultPrevented, true, "Shift+N is claimed even with the search box focused");
    assert.equal(older, true, "Shift+N pages search results forward");
  }

  // Paging pins the NEW page to the top. Gmail loads the next page async and
  // leaves the scroll near the bottom (where the pager was reached); once the
  // page turns (the hash gains its /pN segment) we reset the list to the top and
  // drop the cursor on the first row, instead of landing at the bottom.
  {
    const w = load(pager, "#inbox");
    const main = w.document.querySelector('[role="main"]');
    main.style.overflowY = "scroll";
    Object.defineProperty(main, "scrollHeight", { value: 4000, configurable: true });
    Object.defineProperty(main, "clientHeight", { value: 500, configurable: true });
    main.scrollTop = 4000; // arrived at the bottom, as if scrolled down to reach the pager
    // Older turns the page: model Gmail updating the hash to the next page.
    w.document.querySelector('[aria-label="Older"]').addEventListener("click", () => {
      w.location.hash = "#inbox/p2";
    });

    const n = press(w, "N", { target: w.document.body, shiftKey: true });
    assert.equal(n.defaultPrevented, true, "Shift+N is claimed in the list");
    assert.equal(main.scrollTop, 0, "after the page turns, the list scrolls back to the top");
    assert.equal(rows(w)[0].classList.contains("inboxkeys-cursor"), true, "after paging, the cursor lands on the first row");
  }

  // Search results are the exception: Gmail keeps the "Older"/"Newer" toolbar in
  // the DOM but HIDDEN, and exposes its own visible pager labeled "Next results" /
  // "Previous results". This is what caused "doesn't work with a label or search".
  // Paging must fall through the hidden Older/Newer to the visible search labels.
  {
    const searchPager = `
      <input aria-label="Search mail" name="q" />
      <div role="main">
        <div gh="tl"><table><tbody>
          <tr class="zA" data-row="s1"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">s1</span></td></tr>
        </tbody></table></div>
      </div>
      <div gh="tm">
        <div role="button" aria-label="Newer">Newer</div>
        <div role="button" aria-label="Older">Older</div>
      </div>
      <div class="search-pager">
        <div role="button" aria-label="Previous results">prev</div>
        <div role="button" aria-label="Next results">next</div>
      </div>`;
    const w = load(searchPager, "#search/promo");
    // The leftover toolbar Older/Newer are present but hidden (0x0), as in real
    // search results; isVisible must skip them so the fallback labels win.
    ["Older", "Newer"].forEach((l) => {
      w.document.querySelector(`[aria-label="${l}"]`).getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
    });
    let oldClicked = false, nextClicked = false, prevClicked = false;
    w.document.querySelector('[aria-label="Older"]').addEventListener("click", () => { oldClicked = true; });
    w.document.querySelector('[aria-label="Next results"]').addEventListener("click", () => { nextClicked = true; w.location.hash = "#search/promo/p2"; });
    w.document.querySelector('[aria-label="Previous results"]').addEventListener("click", () => { prevClicked = true; });

    const n = press(w, "N", { target: w.document.body, shiftKey: true });
    assert.equal(n.defaultPrevented, true, "Shift+N is claimed in search results");
    assert.equal(nextClicked, true, "Shift+N pages search via 'Next results' when Older is hidden");
    assert.equal(oldClicked, false, "Shift+N must not click the hidden 'Older' toolbar button");

    const p = press(w, "P", { target: w.document.body, shiftKey: true });
    assert.equal(p.defaultPrevented, true, "Shift+P is claimed in search results");
    assert.equal(prevClicked, true, "Shift+P pages search via 'Previous results' when Newer is hidden");
  }
}

// Tab and Shift+Tab cycle split-inbox tabs only from the list context.
{
  const w = load(listFixture(), "#inbox");

  press(w, "Tab", { target: w.document.body });
  assert.equal(w.location.hash, "#search/in%3Ainbox%20is%3Aunread", "Tab should move to the next split-inbox tab");

  press(w, "Tab", { target: w.document.body, shiftKey: true });
  assert.equal(w.location.hash, "#inbox", "Shift+Tab should move to the previous split-inbox tab");
}

// Gmail can leave the search box focused on a visible list. Split-tab cycling
// should still work because Tab is the user's tab-switching shortcut here.
{
  const w = load(listFixture(), "#inbox");
  const search = w.document.querySelector('input[name="q"]');
  w.InboxKeys.hotkeys.armSearchEditing();
  search.focus();

  const event = press(w, "Tab", { target: search });

  assert.equal(event.defaultPrevented, true, "Tab should be claimed from a focused Gmail search box on the list");
  assert.equal(w.location.hash, "#search/in%3Ainbox%20is%3Aunread", "Tab should move to the next split-inbox tab from search focus");
}

// If Gmail reports searchFocused while a visible list is still on screen, Tab
// should still cycle split-inbox tabs.
{
  const w = load('<input aria-label="Search mail" name="q" /><div role="main"><div role="checkbox"></div></div>', "#inbox");
  const search = w.document.querySelector('input[name="q"]');
  search.focus();

  const event = press(w, "Tab", { target: search });

  assert.equal(w.InboxKeys.gmail.getContext(), "searchFocused", "fixture should exercise the searchFocused context");
  assert.equal(event.defaultPrevented, true, "Tab should be claimed from searchFocused when a list surface is visible");
  assert.equal(w.location.hash, "#search/in%3Ainbox%20is%3Aunread", "Tab should cycle from searchFocused list state");
}

// Native Gmail Important route should be treated as the Important split tab, so
// active-state and Tab cycling both start from the tab the user is looking at.
{
  const w = load(listFixture(), "#imp");

  press(w, "Tab", { target: w.document.body });

  assert.equal(w.location.hash, "#search/in%3Ainbox%20is%3Astarred", "Tab from Gmail's native Important route should move to Starred");
}

// If an already-open Gmail page still has the old built-in tab queries in memory,
// a current inbox-scoped search must still be recognized as that tab. Otherwise
// Tab starts from Inbox and navigates to Unread again, appearing to do nothing.
{
  const w = load(listFixture(), "#search/in%3Ainbox%20is%3Aunread");
  w.InboxKeys.storage.cache.tabs = [
    { id: "inbox", name: "Inbox", type: "inbox", query: "" },
    { id: "unread", name: "Unread", type: "search", query: "is:unread" },
    { id: "important", name: "Important", type: "search", query: "is:important" },
    { id: "starred", name: "Starred", type: "search", query: "is:starred" },
    { id: "attachments", name: "Attachments", type: "search", query: "has:attachment" },
  ];

  press(w, "Tab", { target: w.document.body });

  assert.equal(w.location.hash, "#search/in%3Ainbox%20is%3Aimportant", "Tab from inbox-scoped Unread should advance even with old saved tab queries");
}

// The tab bar should highlight Gmail's native Important route as Important, not
// leave Inbox highlighted or no tab highlighted.
{
  const w = load(listFixture(), "#imp");
  w.InboxKeys.tabs.init();

  const active = Array.from(w.document.querySelectorAll(".inboxkeys-tab--active")).map((b) => b.textContent);

  assert.deepEqual(active, ["Important"], "native #imp should highlight the Important split tab");
}

// The tab bar should also highlight an inbox-scoped query even if the stored
// built-in tab query is the pre-migration value.
{
  const w = load(listFixture(), "#search/in%3Ainbox%20is%3Aunread");
  w.InboxKeys.storage.cache.tabs = [
    { id: "inbox", name: "Inbox", type: "inbox", query: "" },
    { id: "unread", name: "Unread", type: "search", query: "is:unread" },
    { id: "important", name: "Important", type: "search", query: "is:important" },
  ];
  w.InboxKeys.tabs.init();

  const active = Array.from(w.document.querySelectorAll(".inboxkeys-tab--active")).map((b) => b.textContent);

  assert.deepEqual(active, ["Unread"], "inbox-scoped Unread should highlight even when stored Unread query is old");
}

// Gmail sometimes leaves the useful route in the search box rather than the
// hash. In that state, the matching split tab should highlight instead of Inbox.
{
  const w = load(listFixtureWithSearchValue("in:inbox has:attachment"), "#inbox");
  w.InboxKeys.tabs.init();

  const active = Array.from(w.document.querySelectorAll(".inboxkeys-tab--active")).map((b) => b.textContent);

  assert.deepEqual(active, ["Attachments"], "search-box query should drive active split-tab highlighting");
}

// Gmail can repaint filter chips after a split-tab navigation and temporarily
// leave only a generic #search route. Preserve the extension's last split tab
// so highlight and Tab cycling do not reset to Inbox during that repaint.
{
  const w = load(listFixture(), "#inbox");
  const attachments = w.InboxKeys.tabs.list().find((tab) => tab.id === "attachments");
  w.InboxKeys.tabs.navigate(attachments);
  w.location.hash = "#search";
  w.InboxKeys.tabs.init();

  const active = Array.from(w.document.querySelectorAll(".inboxkeys-tab--active")).map((b) => b.textContent);
  assert.deepEqual(active, ["Attachments"], "last split tab should stay highlighted during Gmail search/filter repaint");

  press(w, "Tab", { target: w.document.body });
  assert.equal(w.location.hash, "#inbox", "Tab should cycle forward from the preserved Attachments tab");
}

// Compose/reply bodies are protected: regular letters must not drive list
// navigation while the user is writing.
{
  const w = load(listFixture() + '<div aria-label="Message Body" contenteditable="true"></div>', "#inbox");
  const body = w.document.querySelector('[contenteditable="true"]');
  body.focus();

  const event = press(w, "j", { target: body });

  assert.equal(event.defaultPrevented, false, "typing in compose should not be claimed");
  assert.equal(rows(w).some((row) => row.classList.contains("inboxkeys-cursor")), false, "compose typing should not move the list cursor");
}

// Thread navigation only moves the cursor; Enter on a collapsed focused message
// opens that message, then a second Enter replies once it is expanded.
{
  const w = load(collapsedThreadFixture(), "#inbox/" + ID);
  const headerClicks = [];
  const replyAllCards = [];
  for (const card of w.document.querySelectorAll('[role="listitem"]')) {
    card.querySelector(".gE").addEventListener("click", () => {
      headerClicks.push(card.getAttribute("data-card"));
      if (!card.querySelector(".a3s")) {
        const body = w.document.createElement("div");
        body.className = "a3s";
        body.setAttribute("data-message-id", "expanded-" + card.getAttribute("data-card"));
        body.textContent = "expanded";
        card.appendChild(body);
      }
    });
    card.querySelector(".ams").addEventListener("click", () => {
      replyAllCards.push(card.getAttribute("data-card"));
    });
  }

  press(w, "ArrowUp", { target: w.document.body });
  assert.deepEqual(headerClicks, [], "moving to a message must not expand or collapse it");
  press(w, "Enter", { target: w.document.body });

  assert.deepEqual(headerClicks, ["first"], "first Enter should expand/collapse the focused message card");
  assert.deepEqual(replyAllCards, [], "first Enter should not reply from a collapsed focused message");

  press(w, "Enter", { target: w.document.body });

  assert.deepEqual(replyAllCards, ["first"], "second Enter should reply-all from the now-expanded focused message card");
}

// o remains an explicit expand/collapse shortcut for the focused message.
{
  const w = load(collapsedThreadFixture(), "#inbox/" + ID);
  const headerClicks = [];
  for (const card of w.document.querySelectorAll('[role="listitem"]')) {
    card.querySelector(".gE").addEventListener("click", () => {
      headerClicks.push(card.getAttribute("data-card"));
    });
  }

  press(w, "ArrowUp", { target: w.document.body });
  press(w, "o", { target: w.document.body });

  assert.deepEqual(headerClicks, ["first"], "o should expand/collapse the focused message card");
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

  press(w, "ArrowUp", { target: w.document.body });
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

// Gmail can render a visible Back button while still ignoring synthetic toolbar
// clicks. Escape must still drive hash navigation back to the parent list.
{
  const w = load('<button aria-label="Back to Inbox">Back</button>' + threadFixture(), "#inbox/" + ID);
  const back = w.document.querySelector('[aria-label="Back to Inbox"]');
  back.addEventListener("click", () => {
    w.__clickedGmailBack = true;
  });

  const event = press(w, "Escape", { target: w.document.body });

  assert.equal(event.defaultPrevented, true, "Escape should be claimed in thread view with a visible Gmail Back button");
  assert.equal(w.__clickedGmailBack, true, "Escape should still try Gmail's visible Back button");
  assert.equal(w.location.hash, "#inbox", "Escape should not depend on Gmail accepting the synthetic Back click");
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

// Escape from Gmail's attachment preview closes the preview dialog first instead
// of getting blocked as a generic modal.
{
  const w = load(
    threadFixture() +
      '<div role="dialog"><button aria-label="Download">Download</button><button aria-label="Close">Close</button></div>',
    "#inbox/" + ID
  );
  const close = w.document.querySelector('[aria-label="Close"]');
  close.addEventListener("click", () => {
    w.__closedAttachmentPreview = true;
  });

  const event = press(w, "Escape", { target: w.document.body });

  assert.equal(event.defaultPrevented, true, "Escape should be claimed for attachment preview");
  assert.equal(w.__closedAttachmentPreview, true, "Escape should close the attachment preview");
  assert.equal(w.location.hash, "#inbox/" + ID, "closing preview should not navigate back to the list yet");
}

// Regression: after the attachment preview is CLOSED, Gmail leaves the projector
// dialog in the DOM at full size but aria-hidden. The old width/height-only
// isVisible was fooled, so getContext stayed pinned to attachmentPreview and
// every Escape was hijacked into a no-op re-close — the reported "Escape stops
// working after opening an attachment". A closed (hidden) preview must be ignored
// so Escape goes back to the list as usual.
{
  const closedPreview =
    '<div role="dialog" aria-hidden="true"><button aria-label="Download">Download</button><button aria-label="Close">Close</button></div>';
  const w = load('<button aria-label="Back to Inbox">Back</button>' + threadFixture() + closedPreview, "#inbox/" + ID);
  let reClosed = false;
  w.document.querySelector('[aria-label="Close"]').addEventListener("click", () => {
    reClosed = true;
  });
  let clickedBack = false;
  w.document.querySelector('[aria-label="Back to Inbox"]').addEventListener("click", () => {
    clickedBack = true;
  });

  assert.equal(w.InboxKeys.gmail.getContext(), "threadView", "a closed (aria-hidden) preview must not keep us in attachmentPreview");

  const event = press(w, "Escape", { target: w.document.body });

  assert.equal(event.defaultPrevented, true, "Escape should still be claimed in thread view");
  assert.equal(reClosed, false, "Escape must not re-trigger the already-closed preview");
  assert.equal(clickedBack, true, "Escape should go back to the list, not the stale preview close");
  assert.equal(w.location.hash, "#inbox", "Escape returns to the parent list after the preview is closed");
}

// Gmail menus/dialogs block global shortcuts.
{
  const w = load('<div role="menu">menu</div>' + listFixture(), "#inbox");

  const event = press(w, "j", { target: w.document.body });

  assert.equal(event.defaultPrevented, false, "j should not be claimed while a Gmail menu is open");
  assert.equal(rows(w).some((row) => row.classList.contains("inboxkeys-cursor")), false, "menus should block list movement");
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

// In detail/read view, j moves to the next email/conversation.
{
  const w = load(`
    <div role="main">
      <div role="listitem" data-card="only"><div class="gE">h</div><div class="a3s" data-message-id="m1">body</div></div>
      <button aria-label="Older">Older</button>
      <button aria-label="Newer">Newer</button>
    </div>`, "#inbox/" + ID);
  w.document.querySelector('[aria-label="Older"]').addEventListener("click", () => {
    w.__navigatedThread = "older";
  });
  w.document.querySelector('[aria-label="Newer"]').addEventListener("click", () => {
    w.__navigatedThread = "newer";
  });

  const event = press(w, "j", { target: w.document.body });

  assert.equal(event.defaultPrevented, true, "j should be claimed in thread view");
  assert.equal(w.__navigatedThread, "older", "j should move to the next email/conversation");
}

// In detail/read view, k moves to the previous email/conversation.
{
  const w = load(`
    <div role="main">
      <div role="listitem" data-card="only"><div class="gE">h</div><div class="a3s" data-message-id="m1">body</div></div>
      <button aria-label="Older">Older</button>
      <button aria-label="Newer">Newer</button>
    </div>`, "#inbox/" + ID);
  w.document.querySelector('[aria-label="Older"]').addEventListener("click", () => {
    w.__navigatedThread = "older";
  });
  w.document.querySelector('[aria-label="Newer"]').addEventListener("click", () => {
    w.__navigatedThread = "newer";
  });

  const event = press(w, "k", { target: w.document.body });

  assert.equal(event.defaultPrevented, true, "k should be claimed in thread view");
  assert.equal(w.__navigatedThread, "newer", "k should move to the previous email/conversation");
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
  assert.equal(cardEls[0].classList.contains("inboxkeys-msg-cursor"), true, "ArrowUp moves the indicator to the first card");
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

  assert.equal(expandAll.classList.contains("inboxkeys-msg-cursor"), false, "ArrowDown should not focus the global Expand all control");
  assert.ok(scrolled.length === 1 && scrolled[0] > 0, "ArrowDown at the latest message should scroll instead");
}

// Arrow navigation includes explicit expansion opportunities between message
// cards.
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
  assert.equal(expander.classList.contains("inboxkeys-msg-cursor"), true, "ArrowUp should stop on an expansion opportunity");

  press(w, "o", { target: w.document.body });
  assert.equal(w.__expandedOpportunity, true, "o should activate the focused expansion opportunity");

  press(w, "ArrowDown", { target: w.document.body });
  assert.equal(w.document.querySelector('[data-card="b"]').classList.contains("inboxkeys-msg-cursor"), true, "ArrowDown should continue to the next message card after an expansion control");
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
    Array.from(w.document.querySelectorAll('[role="listitem"]')).some((c) => c.classList.contains("inboxkeys-msg-cursor")),
    false,
    "a single-message thread has no other card to move the indicator to"
  );
}

// ArrowUp walks the message cursor UP across cards (3-message thread): cursor
// starts on the latest message, then steps to the middle one, then the first.
{
  const threeCards = `
    <div role="main">
      <div role="listitem" data-card="a"><div class="gE">a</div><div class="a3s" data-message-id="m1">a</div></div>
      <div role="listitem" data-card="b"><div class="gE">b</div><div class="a3s" data-message-id="m2">b</div></div>
      <div role="listitem" data-card="c"><div class="gE">c</div><div class="a3s" data-message-id="m3">c</div></div>
    </div>`;
  const w = load(threeCards, "#inbox/" + ID);

  press(w, "ArrowUp", { target: w.document.body }); // c -> b
  press(w, "ArrowUp", { target: w.document.body }); // b -> a

  assert.equal(w.document.querySelector('[data-card="a"]').classList.contains("inboxkeys-msg-cursor"), true, "ArrowUp should walk the message cursor up to the first card");
}

// Cmd+K toggles the command palette; Escape closes it. (The palette getting stuck
// open/closed has regressed before.)
{
  const w = load(listFixture(), "#inbox");

  const open = press(w, "k", { target: w.document.body, metaKey: true });
  assert.equal(open.defaultPrevented, true, "Cmd+K should be claimed");
  assert.equal(w.InboxKeys.palette.isOpen(), true, "Cmd+K opens the palette");

  const close = press(w, "Escape", { target: w.document.body });
  assert.equal(close.defaultPrevented, true, "Escape should be claimed while the palette is open");
  assert.equal(w.InboxKeys.palette.isOpen(), false, "Escape closes the palette");
}

// # trashes the focused list row, including the shifted punctuation form most
// keyboards produce.
{
  const w = load(`
    <div role="main"><div gh="tl"><table><tbody>
      <tr class="zA" data-row="one">
        <td><div role="checkbox" aria-checked="false"></div></td>
        <td><span class="bog">one</span></td>
        <td><div role="button" aria-label="Delete">Delete</div></td>
      </tr>
    </tbody></table></div></div>`, "#inbox");
  w.document.querySelector('[aria-label="Delete"]').addEventListener("click", () => {
    w.__deletedRow = "one";
  });

  const event = press(w, "#", { target: w.document.body, shiftKey: true });

  assert.equal(event.defaultPrevented, true, "# should be claimed in the list");
  assert.equal(w.__deletedRow, "one", "# should delete/trash the cursor row");
}

// s toggles the visible star control.
{
  const w = load(`
    <div role="main"><div gh="tl"><table><tbody>
      <tr class="zA" data-row="one">
        <td><div role="checkbox" aria-checked="false"></div></td>
        <td><span class="bog">one</span></td>
        <td><div role="button" aria-label="Not starred">Star</div></td>
      </tr>
    </tbody></table></div></div>`, "#inbox");
  w.document.querySelector('[aria-label="Not starred"]').addEventListener("click", () => {
    w.__starredRow = "one";
  });

  const event = press(w, "s", { target: w.document.body });

  assert.equal(event.defaultPrevented, true, "s should be claimed in the list");
  assert.equal(w.__starredRow, "one", "s should toggle the row star");
}

// z clicks Gmail's visible Undo snackbar action.
{
  const w = load(listFixture() + '<button>Undo</button>', "#inbox");
  w.document.querySelector("button").addEventListener("click", () => {
    w.__undone = true;
  });

  const event = press(w, "z", { target: w.document.body });

  assert.equal(event.defaultPrevented, true, "z should be claimed");
  assert.equal(w.__undone, true, "z should click the Undo action");
}

// u toggles read/unread, h snoozes, Shift+E marks not done, and Shift+M mutes.
{
  const w = load(`
    <div role="main">
      <div role="listitem"><div class="gE">h</div><div class="a3s" data-message-id="m1">body</div></div>
      <div role="toolbar">
        <button aria-label="Mark as read">Mark as read</button>
        <button aria-label="Snooze until">Snooze</button>
        <button aria-label="Move to inbox">Move to inbox</button>
        <button aria-label="Mute">Mute</button>
      </div>
    </div>`, "#inbox/" + ID);
  for (const button of w.document.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      w.__triageAction = button.getAttribute("aria-label");
    });
  }

  press(w, "u", { target: w.document.body });
  assert.equal(w.__triageAction, "Mark as read", "u should mark read/unread");

  press(w, "h", { target: w.document.body });
  assert.equal(w.__triageAction, "Snooze until", "h should open Gmail's native snooze/reminder UI");

  w.__triageAction = null;
  const oldSnooze = press(w, "b", { target: w.document.body });
  assert.equal(oldSnooze.defaultPrevented, false, "b should no longer be a default snooze shortcut");
  assert.equal(w.__triageAction, null, "b should not open snooze by default");

  const snoozeCmd = w.InboxKeys.commands.all().find((cmd) => cmd.id === "snooze");
  assert.deepEqual(Array.from(snoozeCmd.keys), ["h"], "Snooze should default to h only");

  press(w, "E", { target: w.document.body, shiftKey: true });
  assert.equal(w.__triageAction, "Move to inbox", "Shift+E should mark not done");

  press(w, "M", { target: w.document.body, shiftKey: true });
  assert.equal(w.__triageAction, "Mute", "Shift+M should mute");
}

// u on a list row should prefer the row's read/unread control and avoid leaving
// the row selected.
{
  const w = load(`
    <div role="main">
      <div gh="tl"><table><tbody>
        <tr class="zA" data-row="one">
          <td><div role="checkbox" aria-checked="false"></div></td>
          <td><span class="bog">one</span></td>
          <td><div role="button" aria-label="Mark as read">Mark as read</div></td>
        </tr>
      </tbody></table></div>
      <div role="toolbar"><button aria-label="Mark as read">Mark as read</button></div>
    </div>`, "#inbox");
  const checkbox = w.document.querySelector('[role="checkbox"]');
  checkbox.addEventListener("click", (event) => {
    const cb = event.currentTarget;
    cb.setAttribute("aria-checked", cb.getAttribute("aria-checked") === "true" ? "false" : "true");
  });
  w.document.querySelector('tr.zA [aria-label="Mark as read"]').addEventListener("click", () => {
    w.__markedRead = true;
  });

  const event = press(w, "u", { target: w.document.body });

  assert.equal(event.defaultPrevented, true, "u should be claimed in list view");
  assert.equal(w.__markedRead, true, "u should click Mark as read");
  assert.equal(checkbox.getAttribute("aria-checked"), "false", "u should not leave the list row selected");
}

// h on the list should target the current hover/cursor row, not a stale single
// checked row. Otherwise Gmail's native Snooze menu opens for the wrong email.
{
  const w = load(`
    <div role="main">
      <div gh="tl"><table><tbody>
        <tr class="zA" data-row="one">
          <td><div role="checkbox" aria-checked="false"></div></td>
          <td><span class="bog">one</span></td>
        </tr>
        <tr class="zA" data-row="two">
          <td><div role="checkbox" aria-checked="false"></div></td>
          <td><span class="bog">two</span></td>
        </tr>
      </tbody></table></div>
      <div role="toolbar"><button aria-label="Snooze until">Snooze</button></div>
    </div>`, "#inbox");
  for (const row of rows(w)) {
    row.querySelector('[role="checkbox"]').addEventListener("click", (event) => {
      const cb = event.currentTarget;
      cb.setAttribute("aria-checked", cb.getAttribute("aria-checked") === "true" ? "false" : "true");
    });
  }
  const checkboxOne = rows(w)[0].querySelector('[role="checkbox"]');
  const checkboxTwo = rows(w)[1].querySelector('[role="checkbox"]');
  checkboxOne.setAttribute("aria-checked", "true");
  rows(w)[1].dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true }));
  w.document.querySelector('[aria-label="Snooze until"]').addEventListener("click", () => {
    w.__snoozedRows = rows(w)
      .filter((row) => row.querySelector('[role="checkbox"]').getAttribute("aria-checked") === "true")
      .map((row) => row.getAttribute("data-row"));
  });

  const event = press(w, "h", { target: w.document.body });

  assert.equal(event.defaultPrevented, true, "h should be claimed in list view");
  assert.deepEqual(w.__snoozedRows, ["two"], "h should retarget Snooze to the hovered row");
  assert.equal(checkboxOne.getAttribute("aria-checked"), "false", "the stale selected row should be cleared before Snooze");
  assert.equal(checkboxTwo.getAttribute("aria-checked"), "true", "the hovered row should be selected for Gmail's native Snooze menu");
}

// Cmd/Ctrl+U unsubscribes in thread view but remains available to compose fields.
{
  const w = load(`
    <div role="main">
      <div role="listitem"><div class="gE">h</div><div class="a3s" data-message-id="m1">body</div></div>
      <button aria-label="Unsubscribe">Unsubscribe</button>
    </div>`, "#inbox/" + ID);
  w.document.querySelector('[aria-label="Unsubscribe"]').addEventListener("click", () => {
    const dialog = w.document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = '<button>Unsubscribe</button>';
    dialog.querySelector("button").addEventListener("click", () => {
      w.__confirmedUnsubscribe = true;
    });
    w.document.body.appendChild(dialog);
  });

  const event = press(w, "u", { target: w.document.body, metaKey: true });

  assert.equal(event.defaultPrevented, true, "Cmd+U should be claimed in thread view");
  assert.equal(w.__confirmedUnsubscribe, true, "Cmd+U should confirm Gmail's unsubscribe dialog");
}

{
  const w = load(replyFixture(), "#inbox/" + ID);
  const body = w.document.querySelector('[contenteditable="true"]');
  const attach = w.document.createElement("button");
  attach.setAttribute("aria-label", "Attach files");
  attach.addEventListener("click", () => {
    w.__attachedFromReply = true;
  });
  w.document.body.appendChild(attach);
  body.focus();

  const event = press(w, "u", { target: body, metaKey: true });

  assert.equal(event.defaultPrevented, true, "Cmd+U should be claimed while composing");
  assert.equal(w.__attachedFromReply, true, "Cmd+U should attach files while composing");
}

// Cmd/Ctrl+O opens the first link or attachment in the focused message.
{
  const w = load(`
    <div role="main">
      <div role="listitem"><div class="gE">h</div><div class="a3s" data-message-id="m1"><a href="https://example.com">link</a></div></div>
    </div>`, "#inbox/" + ID);
  w.document.querySelector("a").addEventListener("click", (event) => {
    event.preventDefault();
    w.__openedLink = true;
  });

  const event = press(w, "o", { target: w.document.body, metaKey: true });

  assert.equal(event.defaultPrevented, true, "Cmd+O should be claimed in thread view");
  assert.equal(w.__openedLink, true, "Cmd+O should click the focused message link");
}

// Superhuman's attach shortcut is Cmd/Ctrl+U in compose.
{
  const w = load(`
    <div role="dialog">
      <div aria-label="Message Body" contenteditable="true" role="textbox"></div>
      <button aria-label="Attach files">Attach files</button>
    </div>`, "#inbox");
  const body = w.document.querySelector('[contenteditable="true"]');
  body.focus();
  w.document.querySelector('[aria-label="Attach files"]').addEventListener("click", () => {
    w.__attached = true;
  });

  const event = press(w, "u", { target: body, metaKey: true });

  assert.equal(event.defaultPrevented, true, "Cmd+U should be claimed in compose");
  assert.equal(w.__attached, true, "Cmd+U should click Attach files");
}

// Discard draft is Cmd/Ctrl+Shift+D in compose.
{
  const w = load(`
    <div role="dialog">
      <div aria-label="Message Body" contenteditable="true" role="textbox"></div>
      <button aria-label="Discard draft">Discard draft</button>
    </div>`, "#inbox");
  const body = w.document.querySelector('[contenteditable="true"]');
  body.focus();
  w.document.querySelector('[aria-label="Discard draft"]').addEventListener("click", () => {
    w.__discardedDraft = true;
  });

  const entry = w.InboxKeys_KEYMAP.commands.find((cmd) => cmd.id === "discard-draft");
  assert.equal(entry.defaultKeys[0], "Mod+Shift+D", "discard draft should default to Cmd/Ctrl+Shift+D");

  const event = press(w, "d", { target: body, metaKey: true, shiftKey: true });

  assert.equal(event.defaultPrevented, true, "Cmd+Shift+D should be claimed in compose");
  assert.equal(w.__discardedDraft, true, "Cmd+Shift+D should click Discard draft");
}

{
  const w = load(`
    <div class="M9" role="dialog">
      <div class="aO7"><div aria-label="Message Body" contenteditable="true" role="textbox"></div></div>
      <div class="gU">
        <div class="T-I J-J5-Ji aFh" data-tooltip="Discard draft"></div>
      </div>
    </div>`, "#inbox");
  const body = w.document.querySelector('[contenteditable="true"]');
  const discard = w.document.querySelector('[data-tooltip="Discard draft"]');
  body.focus();
  discard.addEventListener("click", () => {
    w.__discardedIconDraft = true;
  });

  const event = press(w, "d", { target: body, metaKey: true, shiftKey: true });

  assert.equal(event.defaultPrevented, true, "Cmd+Shift+D should be claimed for Gmail's icon-style discard button");
  assert.equal(w.__discardedIconDraft, true, "Cmd+Shift+D should click Gmail's icon-style Discard draft control");
}

// Label and move shortcuts drive Gmail toolbar controls.
{
  const w = load(`
    <div role="main">
      <div role="listitem"><div class="gE">h</div><div class="a3s" data-message-id="m1">body</div></div>
      <div role="toolbar">
        <button aria-label="Labels">Labels</button>
        <button aria-label="Remove label">Remove label</button>
        <button aria-label="Remove all labels">Remove all labels</button>
        <button aria-label="Move to">Move to</button>
      </div>
    </div>`, "#inbox/" + ID);
  for (const button of w.document.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      w.__toolbarAction = button.getAttribute("aria-label");
    });
  }

  press(w, "l", { target: w.document.body });
  assert.equal(w.__toolbarAction, "Labels", "l should open the label menu");

  press(w, "y", { target: w.document.body });
  assert.equal(w.__toolbarAction, "Remove label", "y should remove the current label");

  press(w, "Y", { target: w.document.body, shiftKey: true });
  assert.equal(w.__toolbarAction, "Remove all labels", "Shift+Y should remove all labels");

  press(w, "v", { target: w.document.body });
  assert.equal(w.__toolbarAction, "Move to", "v should open the move menu");
}

// Custom shortcuts can use Ctrl/Cmd/Shift modifiers, and remapping a command
// removes the old default from the effective keymap.
{
  const w = load(listFixture(), "#inbox");
  wireList(w);
  w.InboxKeys.storage.cache = {
    ...w.InboxKeys.storage.cache,
    keyOverrides: { archive: ["Ctrl+e"] },
  };

  const bare = press(w, "e", { target: w.document.body });
  assert.equal(bare.defaultPrevented, false, "bare e should no longer archive after archive is remapped");
  assert.equal(w.__archivedRow, undefined, "bare e should not hit the old archive behavior after remap");

  const modified = press(w, "e", { target: w.document.body, ctrlKey: true });
  assert.equal(modified.defaultPrevented, true, "Ctrl+E should be claimed as the archive shortcut");
  assert.equal(w.__archivedRow, "one", "Ctrl+E should run the remapped archive action");
}

{
  const w = load(listFixture(), "#inbox");
  wireList(w);
  w.InboxKeys.storage.cache = {
    ...w.InboxKeys.storage.cache,
    keyOverrides: { archive: ["Shift+A"] },
  };

  const event = press(w, "a", { target: w.document.body, shiftKey: true });
  assert.equal(event.defaultPrevented, true, "Shift plus a letter should be claimable as a custom shortcut");
  assert.equal(w.__archivedRow, "one", "Shift+A should run the remapped archive action");
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
  assert.equal(rows(w)[1].classList.contains("inboxkeys-cursor"), true, "the shortcut still runs after a non-Element target");
}

// Structural row fallback: if Gmail ever renames tr.zA, rows inside the
// thread-list area that carry a [role=checkbox] still navigate. Without the
// fallback, a single class rename killed j/k/x/e/Enter all at once.
{
  const noZa = `
    <div role="main">
      <div gh="tl"><table><tbody>
        <tr data-row="one"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">one</span></td></tr>
        <tr data-row="two"><td><div role="checkbox" aria-checked="false"></div></td><td><span class="bog">two</span></td></tr>
      </tbody></table></div>
    </div>`;
  const w = load(noZa, "#inbox");
  const j = press(w, "j", { target: w.document.body });
  assert.equal(j.defaultPrevented, true, "j is still claimed when Gmail renames the row class");
  const rs = Array.from(w.document.querySelectorAll('[gh="tl"] tr'));
  assert.equal(rs[1].classList.contains("inboxkeys-cursor"), true, "the cursor moves via the structural row fallback");
}

// findControl prefers Gmail's toolbars over a document-wide scan: a link inside
// an email body whose text is exactly "Mute" (a newsletter can do this) must
// not be clicked when the real toolbar control exists. The decoy sits EARLIER
// in DOM order, which is exactly what fooled the old document-wide scan.
{
  const html = `
    <div role="main">
      <div class="a3s"><a href="#decoy">Mute</a></div>
    </div>
    <div gh="tm"><div role="button" aria-label="Mute">Mute</div></div>`;
  const w = load(html, "#inbox/" + ID);
  let decoy = false, toolbar = false;
  w.document.querySelector('a[href="#decoy"]').addEventListener("click", () => { decoy = true; });
  w.document.querySelector('[gh="tm"] [aria-label="Mute"]').addEventListener("click", () => { toolbar = true; });

  w.InboxKeys.gmail.mute();
  assert.equal(toolbar, true, "the toolbar Mute is clicked");
  assert.equal(decoy, false, "the email-body decoy link is NOT clicked");
}

// ...but controls that legitimately live outside any toolbar (Undo snackbar,
// per-message Unsubscribe header button) are still reachable via the
// document-wide fallback when no toolbar offers them.
{
  const w = load('<div role="main"></div><button aria-label="Mute">Mute</button>', "#inbox/" + ID);
  let clicked = false;
  w.document.querySelector('[aria-label="Mute"]').addEventListener("click", () => { clicked = true; });
  w.InboxKeys.gmail.mute();
  assert.equal(clicked, true, "non-toolbar controls are still found by the fallback scan");
}

// A failed action must toast, not silently eat the keystroke. The old behavior
// on a Gmail rename was consume() + realClick(null): the key did nothing with
// zero signal, and a user report was the only detection mechanism.
{
  const w = load(threadFixture(), "#inbox/" + ID);
  const toasts = [];
  w.InboxKeys.toast = (msg) => { toasts.push(String(msg)); };
  const f = press(w, "f", { target: w.document.body });
  assert.equal(f.defaultPrevented, true, "f is claimed in thread view");
  assert.equal(
    toasts.some((t) => /not found: Forward/.test(t)),
    true,
    "a missing Forward control surfaces a toast naming the control"
  );
}

// The verify-selectors smoke probe (palette: "Verify Gmail selectors") reports
// exactly which registry hooks are missing on the current surface.
{
  const w = load(listFixture(), "#inbox");
  w.InboxKeys.toast = () => {};
  w.console = { table: () => {} }; // keep the probe table out of test output
  const out = w.InboxKeys.gmail.verifySelectors();
  assert.equal(out.surface, "list", "a list hash probes the list surface");
  const failedNames = out.failed.map((f) => f.probe);
  assert.equal(failedNames.includes("compose button"), true, "the missing compose button is reported by name");
  assert.equal(failedNames.includes("list rows (tr.zA)"), false, "present probes pass");
  const rowProbe = out.results.find((r) => r.probe === "list rows (tr.zA)");
  assert.equal(rowProbe.count >= 2, true, "probe results carry visible-match counts");
}

// Once the account list is known (the MAIN-world bridge enumerated it into
// accountNames), the palette shows EXACTLY those accounts, every row by email —
// no "account u/N" placeholders for slots that don't correspond to a real account.
{
  const w = load(listFixture(), "#inbox");
  w.InboxKeys.storage.cache.accountNames = { "0": "me@gmail.com", "3": "work@revelai.com", "5": "side@x.com" };
  const cmds = w.InboxKeys.commands.all();
  const accts = cmds.filter((c) => /^acct-\d+$/.test(c.id));
  assert.equal(accts.length, 3, "shows exactly the known accounts, not a fixed 0..8 range");
  assert.equal(accts.every((c) => /Switch to \S+@/.test(c.title)), true, "every account row is labelled by email");
  assert.equal(cmds.some((c) => c.id === "acct-7"), false, "no placeholder row for a slot that isn't a real account");
  assert.equal(cmds.some((c) => c.id === "acct-3" && /work@revelai\.com/.test(c.title)), true, "a known account is labelled by its email");
  assert.equal(cmds.some((c) => c.id === "accounts-config"), true, "still offers Configure accounts…");
}

// Cold start: before the bridge has populated accountNames, fall back to the
// g 0–g 8 slots so multi-account switching still works immediately.
{
  const w = load(listFixture(), "#inbox");
  w.InboxKeys.storage.cache.accountNames = {};
  const accts = w.InboxKeys.commands.all().filter((c) => /^acct-\d+$/.test(c.id));
  assert.equal(accts.length, 9, "cold start falls back to all nine g 0–g 8 slots");
  assert.equal(accts.some((c) => c.id === "acct-8"), true, "fallback reaches u/8");
}

// account-sync.js: the isolated receiver validates and persists the list the
// main-world bridge posts. Garbage entries are dropped; valid ones are stored.
{
  const w = load(listFixture(), "#inbox");
  w.InboxKeys.storage.cache.accountNames = {};
  let saved = null;
  w.InboxKeys.storage.set = async (patch) => {
    saved = patch;
    Object.assign(w.InboxKeys.storage.cache, patch);
  };
  const changed = w.InboxKeys.accountSync.ingest([
    { index: 0, email: "me@gmail.com", name: "Me" },
    { index: 3, email: "work@revelai.com" },
    { index: 99, email: "toobig@x.com" }, // out-of-range index → dropped
    { index: 4, email: "not-an-email" }, // malformed email → dropped
  ]);
  assert.equal(changed, true, "ingest reports a change");
  const persisted = (saved && saved.accountNames) || {};
  assert.equal(persisted["0"], "me@gmail.com", "valid account 0 persisted");
  assert.equal(persisted["3"], "work@revelai.com", "valid account 3 persisted");
  assert.equal(Object.keys(persisted).length, 2, "out-of-range index and malformed email are dropped");
  assert.equal(w.InboxKeys.accountSync.ingest([]), false, "an empty list is a no-op");
}

console.log("hotkey integration tests passed");
