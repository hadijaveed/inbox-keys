// Calendar driver tests. The fixture mirrors the real Google Calendar DOM
// verified live (June 2026): rail lists [aria-label="My calendars"] /
// "Other calendars" holding input[type="checkbox"][aria-label="<name>"], the
// [aria-label="Add other calendars"] +, and the From URL -> addbyurl form.
const assert = require("node:assert/strict");
const { tryLoadGcal } = require("./helpers.js");

if (!tryLoadGcal("")) {
  console.log("gcal tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

function railFixture() {
  return `
    <button id="create-btn">addCreatearrow_drop_down</button>
    <input type="text" aria-label="Search for people" />
    <div role="list" aria-label="My calendars">
      <div data-id="m1"><input type="checkbox" aria-label="hadi javeed" checked></div>
      <div data-id="m2"><input type="checkbox" aria-label="Birthdays"></div>
    </div>
    <div role="list" aria-label="Other calendars">
      <div data-id="o1"><input type="checkbox" aria-label="hadi@prodify.io" checked></div>
      <div data-id="o2"><input type="checkbox" aria-label="Holidays in United States"></div>
    </div>
    <button aria-label="Add other calendars">+</button>
    <button aria-label="Today, Thursday, June 18">Today</button>
    <button aria-label="Previous week"></button>
    <button aria-label="Next week"></button>
    <button aria-haspopup="menu">Weekarrow_drop_down</button>`;
}

// Record every click on a calendar toggle by its name.
function recordToggleClicks(w) {
  const clicked = [];
  for (const input of w.document.querySelectorAll('[role="list"] input[type="checkbox"]')) {
    input.addEventListener("click", () => clicked.push(input.getAttribute("aria-label")));
  }
  return clicked;
}

// 1. calendars() reads both rail lists with names + checked state.
{
  const w = tryLoadGcal(railFixture());
  // Array.from re-homes the jsdom-realm array into this realm so deepStrictEqual
  // (which compares prototypes) isn't tripped by the cross-realm Array.
  const cals = Array.from(w.InboxKeys.gcal.calendars());
  assert.deepEqual(
    cals.map((c) => `${c.name}:${c.checked}:${c.which}`),
    ["hadi javeed:true:mine", "Birthdays:false:mine", "hadi@prodify.io:true:other", "Holidays in United States:false:other"],
    "calendars() returns every rail calendar with its checked state and which list it is in"
  );
}

// 2. focusOnly toggles exactly the layers that must change: the target on, every
//    other currently-on layer off, and leaves already-off layers alone.
{
  const w = tryLoadGcal(railFixture());
  const clicked = recordToggleClicks(w);
  const ok = w.InboxKeys.gcal.focusOnly("Birthdays");
  assert.equal(ok, true, "focusOnly finds the target calendar");
  assert.deepEqual(
    clicked,
    ["hadi javeed", "Birthdays", "hadi@prodify.io"],
    "focus clicks the two on-layers off and the target on, never the already-off layer"
  );
}

// 3. showAll clicks only the currently-hidden layers.
{
  const w = tryLoadGcal(railFixture());
  const clicked = recordToggleClicks(w);
  const n = w.InboxKeys.gcal.showAll();
  assert.equal(n, 2, "showAll reports the number of layers it turned on");
  assert.deepEqual(clicked, ["Birthdays", "Holidays in United States"], "showAll clicks only the hidden layers");
}

// 4. setShown is idempotent: it clicks only when the state must change.
{
  const w = tryLoadGcal(railFixture());
  const clicked = recordToggleClicks(w);
  w.InboxKeys.gcal.setShown("hadi javeed", true); // already on -> no click
  w.InboxKeys.gcal.setShown("Birthdays", true); // off -> click
  assert.deepEqual(clicked, ["Birthdays"], "setShown only clicks the toggle that needs to change");
}

// 5. addByUrl drives the real flow client-side: open the + menu, pick From URL,
//    fill the (non-search) field, click Add calendar. The fixture wires those
//    steps synchronously, the way Calendar reveals them.
{
  const w = tryLoadGcal(railFixture());
  const d = w.document;
  const ICS = "https://outlook.office365.com/owa/calendar/abc/cal.ics";
  let submittedValue = null;

  d.querySelector('[aria-label="Add other calendars"]').addEventListener("click", () => {
    if (d.querySelector("#menu")) return;
    const menu = d.createElement("div");
    menu.id = "menu";
    menu.innerHTML = `<div role="menuitem">Subscribe to calendar</div><div role="menuitem">From URL</div>`;
    d.body.appendChild(menu);
    // The "From URL" item navigates the SPA to the addbyurl pane: render the
    // heading, the lone URL text field, and the Add calendar button.
    menu.querySelectorAll('[role="menuitem"]').forEach((mi) => {
      mi.addEventListener("click", () => {
        if ((mi.textContent || "").trim() !== "From URL") return;
        const pane = d.createElement("div");
        pane.innerHTML = `
          <div role="heading">Settings page that allows to subscribe to a calendar by its URL.</div>
          <input type="text" id="ics-url" />
          <button id="add-cal">Add calendar</button>`;
        d.body.appendChild(pane);
        d.querySelector("#add-cal").addEventListener("click", () => {
          submittedValue = d.querySelector("#ics-url").value;
        });
      });
    });
  });

  const started = w.InboxKeys.gcal.addByUrl(ICS);
  assert.equal(started, true, "addByUrl starts the flow");
  assert.equal(submittedValue, ICS, "the ICS URL is filled into the field and Add calendar is clicked");
  assert.equal(
    w.__toasts.some((t) => /Adding calendar feed/.test(t.msg)),
    true,
    "a confirming toast fires after submit"
  );
}

// 6. addByUrl must NOT mistake Calendar's "Search for people" box for the URL
//    field if the pane never renders its own input: it should toast a loud miss,
//    not silently type the ICS into search.
{
  const w = tryLoadGcal(railFixture());
  const d = w.document;
  d.querySelector('[aria-label="Add other calendars"]').addEventListener("click", () => {
    if (d.querySelector("#menu")) return;
    const menu = d.createElement("div");
    menu.id = "menu";
    menu.innerHTML = `<div role="menuitem">From URL</div>`;
    d.body.appendChild(menu);
    // Intentionally render NO addbyurl pane (simulate a broken/renamed route).
  });
  w.InboxKeys.gcal.addByUrl("https://example.com/x.ics");
  const search = d.querySelector('[aria-label="Search for people"]');
  assert.equal(search.value, "", "the ICS URL is never typed into the people-search box");
}

// 7. verifySelectors passes on a healthy rail and names what is missing otherwise.
{
  const w = tryLoadGcal(railFixture());
  w.console = { table: () => {} };
  const ok = w.InboxKeys.gcal.verifySelectors();
  assert.equal(ok.failed.length, 0, "a healthy calendar rail passes every probe");

  const w2 = tryLoadGcal(`<div role="list" aria-label="My calendars"></div>`);
  w2.console = { table: () => {} };
  const bad = w2.InboxKeys.gcal.verifySelectors();
  assert.equal(
    bad.failed.some((f) => f.probe === "Add other calendars (+)"),
    true,
    "a missing add control is reported by name"
  );
}

// 8. createEvent clicks the main Create split-button (text carries the "Create"
//    ligature, no aria-label) and never the "Create appointment schedule" lookalike.
{
  const w = tryLoadGcal(`
    <button class="main">addCreatearrow_drop_down</button>
    <button aria-label="Create appointment schedule">add</button>`);
  const d = w.document;
  let clicked = null;
  d.querySelector("button.main").addEventListener("click", () => (clicked = "main"));
  d.querySelector('[aria-label="Create appointment schedule"]').addEventListener("click", () => (clicked = "appointment"));
  const ok = w.InboxKeys.gcal.createEvent();
  assert.equal(ok, true, "createEvent finds the main Create button");
  assert.equal(clicked, "main", "createEvent clicks the main Create button, not the appointment-schedule lookalike");
}

// 9. today() clicks the Today control (aria-label starts with "Today").
{
  const w = tryLoadGcal(`<button aria-label="Today, Thursday, June 18">Today</button>`);
  const d = w.document;
  let clicked = false;
  d.querySelector('[aria-label^="Today"]').addEventListener("click", () => (clicked = true));
  const ok = w.InboxKeys.gcal.today();
  assert.equal(ok, true, "today() finds the Today control");
  assert.equal(clicked, true, "today() clicks it");
}

// 10. view() drives the view-switcher dropdown (verified live): the switcher is
//     a haspopup=menu button whose label starts with the current view name; the
//     menu items read "<View><shortcut>" (e.g. "MonthM"), matched by prefix.
{
  const w = tryLoadGcal(`<button aria-haspopup="menu">Weekarrow_drop_down</button>`);
  const d = w.document;
  let picked = null;
  d.querySelector('[aria-haspopup="menu"]').addEventListener("click", () => {
    if (d.querySelector("#vmenu")) return;
    const menu = d.createElement("div");
    menu.id = "vmenu";
    menu.innerHTML = `<div role="menuitem">DayD</div><div role="menuitem">WeekW</div><div role="menuitem">MonthM</div>`;
    d.body.appendChild(menu);
    menu.querySelectorAll('[role="menuitem"]').forEach((mi) =>
      mi.addEventListener("click", () => (picked = (mi.textContent || "").trim()))
    );
  });
  const ok = w.InboxKeys.gcal.view("Month");
  assert.equal(ok, true, "view() opens the switcher and runs the menu flow");
  assert.equal(picked, "MonthM", "view('Month') clicks the menu item whose text starts with 'Month'");
}

// 11. period() targets the MAIN nav, never the mini-calendar duplicate. In month
//     view both read "Next month"; we take the topmost (the top toolbar one).
{
  const w = tryLoadGcal(`
    <button id="main" aria-label="Next month"></button>
    <button id="mini" aria-label="Next month"></button>`);
  const d = w.document;
  d.querySelector("#main").getBoundingClientRect = () => ({ top: 16, left: 0, width: 120, height: 20, right: 120, bottom: 36 });
  d.querySelector("#mini").getBoundingClientRect = () => ({ top: 164, left: 0, width: 120, height: 20, right: 120, bottom: 184 });
  let clicked = null;
  d.querySelector("#main").addEventListener("click", () => (clicked = "main"));
  d.querySelector("#mini").addEventListener("click", () => (clicked = "mini"));
  const ok = w.InboxKeys.gcal.period(1);
  assert.equal(ok, true, "period() finds a Next button");
  assert.equal(clicked, "main", "period() clicks the topmost (main toolbar) nav, not the mini-calendar");
}

// 12. accountEmail() parses the email out of the account-switcher aria-label.
{
  const w = tryLoadGcal(`<a aria-label="Google Account: hadi javeed (hadij.pk@gmail.com)"></a>`);
  assert.equal(
    w.InboxKeys.gcal.accountEmail(),
    "hadij.pk@gmail.com",
    "accountEmail parses the email from the account switcher label"
  );
  const w2 = tryLoadGcal(`<div>no account here</div>`);
  assert.equal(w2.InboxKeys.gcal.accountEmail(), null, "accountEmail returns null when the account label is absent");
}

// 13. addCalendarUrl points at Calendar's own add-calendar settings page for the
//     CURRENT account index (never hardcoded), so "add a calendar" follows you.
{
  const w = tryLoadGcal("");
  const idx = w.InboxKeys.gcal.accountIndex();
  assert.equal(
    w.InboxKeys.gcal.addCalendarUrl(),
    `https://calendar.google.com/calendar/u/${idx}/r/settings/addcalendar`,
    "addCalendarUrl targets the /settings/addcalendar route for the account index parsed from the URL"
  );
}

console.log("gcal driver tests passed");
