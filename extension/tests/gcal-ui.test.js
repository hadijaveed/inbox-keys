// In-calendar UI layer: the command model behind the Cmd+K overlay and the
// "keep adding" intent. Verifies the overlay always leads with add-source
// actions and that filtering/exec wiring is sound.
const assert = require("node:assert/strict");
const { tryLoadGcalUi } = require("./helpers.js");

if (!tryLoadGcalUi("")) {
  console.log("gcal-ui tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

function railFixture() {
  return `
    <div role="list" aria-label="My calendars">
      <div data-id="m1"><input type="checkbox" aria-label="hadi javeed" checked></div>
    </div>
    <div role="list" aria-label="Other calendars">
      <div data-id="o1"><input type="checkbox" aria-label="hadi@prodify.io" checked></div>
      <div data-id="o2"><input type="checkbox" aria-label="Holidays in United States"></div>
    </div>
    <button aria-label="Add other calendars">+</button>`;
}

// 1. The overlay always leads with the two "add a source" actions, so the user
//    is continuously prompted to keep adding accounts and Outlook feeds.
{
  const w = tryLoadGcalUi(railFixture());
  const cmds = Array.from(w.InboxKeys.gcalui.calendarCommands());
  assert.equal(cmds[0].id, "add-ics", "the iCal/Outlook add is the very first action");
  assert.equal(cmds[1].id, "add-google", "adding another Google account is the second action");
  assert.equal(cmds[0].kind, "add", "add actions are tagged so the UI can badge them");
}

// 2. Every rail calendar gets both a toggle and a focus command, labelled by its
//    current shown/hidden state.
{
  const w = tryLoadGcalUi(railFixture());
  const cmds = Array.from(w.InboxKeys.gcalui.calendarCommands());
  assert.equal(
    cmds.some((c) => c.id === "toggle:Holidays in United States" && /^Show /.test(c.title)),
    true,
    "a hidden calendar offers a 'Show' toggle"
  );
  assert.equal(
    cmds.some((c) => c.id === "toggle:hadi@prodify.io" && /^Hide /.test(c.title)),
    true,
    "a visible calendar offers a 'Hide' toggle"
  );
  assert.equal(cmds.filter((c) => c.id.startsWith("focus:")).length, 3, "every calendar gets a focus-only command");
}

// 3. Running a toggle command drives the underlying calendar input (realClick).
{
  const w = tryLoadGcalUi(railFixture());
  let clicked = null;
  w.document
    .querySelector('input[aria-label="Holidays in United States"]')
    .addEventListener("click", () => (clicked = "Holidays in United States"));
  const cmds = Array.from(w.InboxKeys.gcalui.calendarCommands());
  cmds.find((c) => c.id === "toggle:Holidays in United States").run();
  assert.equal(clicked, "Holidays in United States", "the toggle command clicks the calendar's checkbox");
}

// 4. filterCommands does token substring matching; empty query returns all.
{
  const w = tryLoadGcalUi(railFixture());
  const { calendarCommands, filterCommands } = w.InboxKeys.gcalui;
  const cmds = calendarCommands();
  assert.equal(filterCommands(cmds, "").length, cmds.length, "empty query returns everything");
  const outlook = filterCommands(cmds, "outlook");
  assert.equal(outlook.length >= 1 && outlook.every((c) => /outlook/i.test(c.title)), true, "query narrows to matching titles");
  assert.equal(filterCommands(cmds, "focus prodify").some((c) => c.id === "focus:hadi@prodify.io"), true, "multi-token query matches across the title");
}

// 5. "Go to" account-switch commands: offered for other account slots, never
//    for the current account, and labelled by email once one is known.
{
  const w = tryLoadGcalUi(railFixture());
  let cmds = Array.from(w.InboxKeys.gcalui.calendarCommands());
  assert.equal(cmds.some((c) => c.id === "acct:1" && c.kind === "go"), true, "offers a switch command for another account slot");
  assert.equal(cmds.some((c) => c.id === "acct:0"), false, "never offers a switch to the account you are already in");
  w.InboxKeys.storage.cache.accountNames = { "1": "work@revelai.com" };
  cmds = Array.from(w.InboxKeys.gcalui.calendarCommands());
  assert.equal(
    cmds.some((c) => c.id === "acct:1" && c.title === "Switch to work@revelai.com"),
    true,
    "a known account is labelled by its email"
  );
}

// 6. Navigation-mirror commands exist so the palette can drive create/today/views
//    even when Calendar's own keyboard shortcuts are off.
{
  const w = tryLoadGcalUi(railFixture());
  const cmds = Array.from(w.InboxKeys.gcalui.calendarCommands());
  const keys = { today: "t", prev: "←", next: "→", "view-day": "d", "view-week": "w", "view-month": "m", create: "c" };
  for (const [id, key] of Object.entries(keys)) {
    const c = cmds.find((x) => x.id === id);
    assert.ok(c && c.kind === "nav", `the overlay offers the ${id} command`);
    assert.equal(c.key, key, `${id} advertises its shortcut key '${key}' so the overlay can show it`);
  }
  // The keys are actually rendered in the overlay rows.
  w.InboxKeys.gcalui.openOverlay();
  const shown = Array.from(w.document.querySelectorAll(".inboxkeys-gcal-kbd")).map((k) => k.textContent);
  assert.ok(
    shown.includes("t") && shown.includes("c") && shown.includes("←") && shown.includes("→"),
    "shortcut keys (including the back/forward arrows) are visible in the overlay"
  );
}

// 7. The single-key engine: a bare key drives the matching control and is
//    consumed (so Calendar never double-handles it); modifiers and typing are
//    left alone.
{
  const w = tryLoadGcalUi(
    `<button aria-label="Today, Friday June 19">Today</button>
     <button aria-label="Previous week"></button>
     <button aria-label="Next week"></button>` + railFixture()
  );
  const d = w.document;
  let clicked = false;
  d.querySelector('[aria-label^="Today"]').addEventListener("click", () => (clicked = true));
  const { onKeydown } = w.InboxKeys.gcalui;
  const ev = (props) =>
    Object.assign(
      {
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        target: d.body,
        preventDefault() {
          this._pd = true;
        },
        stopImmediatePropagation() {
          this._sip = true;
        },
      },
      props
    );

  const e1 = ev({ key: "t" });
  onKeydown(e1);
  assert.equal(clicked, true, "a bare 't' drives the Today control");
  assert.equal(e1._pd === true && e1._sip === true, true, "the key is consumed so Calendar does not double-handle it");

  clicked = false;
  onKeydown(ev({ key: "t", metaKey: true }));
  assert.equal(clicked, false, "a modifier combo (Cmd+T) is left for the browser");

  clicked = false;
  const input = d.createElement("input");
  d.body.appendChild(input);
  onKeydown(ev({ key: "t", target: input }));
  assert.equal(clicked, false, "single keys never fire while typing in a field");

  clicked = false;
  onKeydown(ev({ key: "t", defaultPrevented: true }));
  assert.equal(clicked, false, "defers when Calendar already handled the key (its shortcuts are on), avoiding double-action");

  // Left/Right arrows drive previous/next period via the real nav buttons.
  let moved = null;
  d.querySelector('[aria-label="Next week"]').addEventListener("click", () => (moved = "next"));
  d.querySelector('[aria-label="Previous week"]').addEventListener("click", () => (moved = "prev"));
  const eRight = ev({ key: "ArrowRight" });
  onKeydown(eRight);
  assert.equal(moved, "next", "Right arrow advances to the next period");
  assert.equal(eRight._pd === true && eRight._sip === true, true, "the arrow key is consumed");
  moved = null;
  onKeydown(ev({ key: "ArrowLeft" }));
  assert.equal(moved, "prev", "Left arrow goes to the previous period");
}

// 8. Escape closes our overlay from the document-level capture handler (the
//    overlay input's own Escape listener can be pre-empted by Calendar's).
{
  const w = tryLoadGcalUi(railFixture());
  const { openOverlay, onKeydown } = w.InboxKeys.gcalui;
  openOverlay();
  assert.equal(!!w.document.querySelector(".inboxkeys-gcal-overlay"), true, "overlay opens");
  const e = {
    key: "Escape",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: w.document.body,
    preventDefault() {
      this._pd = true;
    },
    stopImmediatePropagation() {
      this._sip = true;
    },
  };
  onKeydown(e);
  assert.equal(w.document.querySelector(".inboxkeys-gcal-overlay"), null, "Escape closes the overlay");
  assert.equal(e._pd === true && e._sip === true, true, "Escape is consumed so Calendar does not also act on it");
}

// 9. "Add another Google account" opens a guided, numbered sharing walkthrough
//    (prefilled with this account's email) rather than a one-click add, because
//    cross-account merge is a real Google share flow.
{
  const w = tryLoadGcalUi(railFixture());
  const cmd = Array.from(w.InboxKeys.gcalui.calendarCommands()).find((c) => c.id === "add-google");
  cmd.run();
  const panel = w.document.querySelector(".inboxkeys-gcal-panel");
  assert.ok(panel, "a guide panel opens");
  assert.ok(panel.querySelector("ol li"), "the guide is a numbered step list");
  assert.match(
    panel.textContent,
    /Share with specific people|Settings for my calendars|would like to view your calendar/i,
    "the guide explains Calendar's sharing process"
  );
}

// 10. The overlay closes the instant focus leaves it. This is the reliable
//     one-press Escape on Calendar, whose window-level handler swallows the
//     keydown but blurs our search box (moving focus out, which we catch).
(async () => {
  const w = tryLoadGcalUi(railFixture());
  w.InboxKeys.gcalui.openOverlay();
  const overlay = w.document.querySelector(".inboxkeys-gcal-overlay");
  assert.ok(overlay, "overlay open");
  const input = overlay.querySelector("input");
  if (input && input.blur) input.blur();
  if (w.document.body.focus) w.document.body.focus();
  overlay.dispatchEvent(new w.Event("focusout", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(
    w.document.querySelector(".inboxkeys-gcal-overlay"),
    null,
    "overlay closes once focus leaves it (single-press Escape)"
  );
  console.log("gcal-ui tests passed");
})();
