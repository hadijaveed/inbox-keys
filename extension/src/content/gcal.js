// Google Calendar driver: the core for the in-calendar layer.
//
// Same philosophy as gmail.js. Calendar ignores synthetic keystrokes and many
// of its controls only react to a full pointer+mouse gesture, so we never fake
// keys and always drive the real control through gcal.realClick. Every
// load-bearing selector lives in ONE registry (gcal.SEL), verified live against
// real Google Calendar (June 2026) and mirrored in the test fixtures.
//
// Verified hooks (re-verified live against real Google Calendar, June 18 2026):
//   [aria-label="My calendars"] / [aria-label="Other calendars"]  the rail lists (role=list)
//   input[type="checkbox"][aria-label="<calendar name>"]          a calendar's show/hide toggle
//   [aria-label="Add other calendars"]                            the + that opens the add menu
//   menuitem "From URL"                                           ICS subscribe entry
//   /calendar/u/N/r/settings/addbyurl                             the add-by-URL form route
//   view switcher: button[aria-haspopup="menu"] whose text starts with the
//                  current view name ("Weekarrow_drop_down"); the menu items are
//                  role="menuitem" with text "<View><shortcut>" e.g. "MonthM"
//   period nav: button[aria-label^="Next "|"Previous "] + view unit
//                  ("Next week"/"Next month"…); a mini-calendar duplicate sits
//                  lower in the sidebar, so the MAIN nav is the topmost match
//   [aria-label^="Today"]                                         the Today button
//   [aria-label^="Google Account:"]                               account switcher (email in parens)
//   /calendar/u/N/r                                               account index in the URL
window.InboxKeys = window.InboxKeys || {};

(function () {
  const SEL = {
    myCalendars: '[aria-label="My calendars"]',
    otherCalendars: '[aria-label="Other calendars"]',
    calToggle: 'input[type="checkbox"]', // scoped to a rail list; aria-label is the calendar name
    addOther: '[aria-label="Add other calendars"]',
    addByUrlInput: 'input[type="text"]', // the lone text field on the addbyurl pane
    today: '[aria-label^="Today"]',
    account: '[aria-label^="Google Account:"]',
  };

  // The view switcher's label and each view menu item's text both START WITH a
  // view name (the switcher adds an "arrow_drop_down" ligature, the menu items
  // add the keyboard-shortcut letter, e.g. "MonthM"), so we match by prefix.
  const VIEW_RE = /^(Day|Week|Month|Year|Schedule|\d)/;
  // A period-nav button: "Next/Previous" + the current view's unit.
  const PERIOD_RE = /^(Next|Previous) (day|week|month|year|\d+ days?|custom)/i;

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const s = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  }

  // Full pointer+mouse gesture at the element center. Calendar's toggles and
  // menu items ignore a bare element.click(), same as Gmail's controls.
  function realClick(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: el.ownerDocument.defaultView || window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    for (const type of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ctor = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, opts));
    }
    return true;
  }

  // Poll for an element/condition, then run onFound; give up after `tries`.
  // Synchronous-first so jsdom fixtures resolve without timers.
  function waitFor(find, onFound, onGiveUp, tries = 20, interval = 80) {
    const el = find();
    if (el) return onFound(el);
    if (tries <= 0) return onGiveUp && onGiveUp();
    setTimeout(() => waitFor(find, onFound, onGiveUp, tries - 1, interval), interval);
    return true;
  }

  function toast(msg, opts) {
    if (InboxKeys.toast) InboxKeys.toast(msg, opts);
  }

  function accountIndex() {
    const m = location.pathname.match(/\/u\/(\d+)\b/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function railLists() {
    return [SEL.myCalendars, SEL.otherCalendars]
      .map((s) => document.querySelector(s))
      .filter(Boolean);
  }

  // Every calendar in the rail as { name, checked, input, list }. The rail
  // renders a beat after the grid, so callers that need it fresh should waitFor
  // calendars().length first.
  function calendars() {
    const out = [];
    for (const list of railLists()) {
      const which = list.getAttribute("aria-label") === "Other calendars" ? "other" : "mine";
      for (const input of list.querySelectorAll(SEL.calToggle)) {
        const name = input.getAttribute("aria-label");
        if (!name) continue;
        out.push({ name, checked: !!input.checked, input, which });
      }
    }
    return out;
  }

  function findCalendar(name) {
    return calendars().find((c) => c.name === name) || null;
  }

  // Show or hide one calendar layer by name. Returns true if the toggle moved.
  function setShown(name, want) {
    const c = findCalendar(name);
    if (!c) return false;
    if (c.checked !== want) realClick(c.input);
    return true;
  }

  function toggle(name) {
    const c = findCalendar(name);
    if (!c) return false;
    realClick(c.input);
    return true;
  }

  // Turn every layer on (the "show all" reset).
  function showAll() {
    let n = 0;
    for (const c of calendars()) {
      if (!c.checked) {
        realClick(c.input);
        n++;
      }
    }
    return n;
  }

  // Focus a single layer: that one on, all others off. The heart of "f".
  function focusOnly(name) {
    if (!findCalendar(name)) return false;
    for (const c of calendars()) {
      const want = c.name === name;
      if (c.checked !== want) realClick(c.input);
    }
    return true;
  }

  // Set a controlled (Closure/React) input's value so the framework registers
  // it: drive the native setter, then fire input+change. A bare `el.value = x`
  // is silently ignored by Calendar's settings form.
  function setControlledValue(input, value) {
    const proto = input.ownerDocument.defaultView.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // A visible menu item by exact (trimmed) text.
  function menuItem(text) {
    return Array.from(document.querySelectorAll('[role="menuitem"]'))
      .filter(isVisible)
      .find((e) => (e.textContent || "").trim() === text) || null;
  }

  // A visible button whose text or aria-label matches.
  function buttonMatching(re) {
    return Array.from(document.querySelectorAll('button,[role="button"]'))
      .filter(isVisible)
      .find((b) => re.test((b.textContent || "").trim()) || re.test(b.getAttribute("aria-label") || "")) || null;
  }

  // Are we on the add-by-URL settings pane? The path is the primary signal (the
  // SPA routes to /settings/addbyurl without a reload); the heading is a DOM
  // fallback so a route shape change doesn't blind us.
  function onAddByUrlPane() {
    if (/\/settings\/addbyurl/.test(location.pathname)) return true;
    return !!Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]')).find((h) =>
      /subscribe to a calendar by its url/i.test(h.textContent || "")
    );
  }

  // The URL field on the addbyurl pane, never Calendar's "Search for people"
  // box (the only other visible text input). The real field has no aria-label.
  function addByUrlField() {
    return (
      Array.from(document.querySelectorAll(SEL.addByUrlInput))
        .filter(isVisible)
        .find((i) => (i.getAttribute("aria-label") || "") !== "Search for people") || null
    );
  }


  // Subscribe to an external calendar (e.g. an Outlook ICS feed) by URL, all
  // client-side: open the add menu, pick "From URL", fill the field, click Add.
  // Loud toast on any missing control so a Calendar DOM change is never silent.
  function addByUrl(url) {
    if (!url) return false;
    const add = document.querySelector(SEL.addOther);
    if (!add) {
      toast("Calendar control not found: Add other calendars", { kind: "warn" });
      return false;
    }
    realClick(add);
    waitFor(
      () => menuItem("From URL"),
      (item) => {
        realClick(item);
        waitFor(
          () => (onAddByUrlPane() && addByUrlField() ? addByUrlField() : null),
          (input) => {
            setControlledValue(input, url);
            waitFor(
              () => buttonMatching(/^Add calendar$/i),
              (btn) => {
                realClick(btn);
                toast("Adding calendar feed…");
              },
              () => toast("Calendar control not found: Add calendar", { kind: "warn" })
            );
          },
          () => toast("Calendar control not found: URL field", { kind: "warn" })
        );
      },
      () => toast("Calendar menu item not found: From URL", { kind: "warn" })
    );
    return true;
  }

  // Open the add-other-calendars menu (so the user can pick Subscribe/From URL).
  function openAddMenu() {
    const add = document.querySelector(SEL.addOther);
    if (!add) {
      toast("Calendar control not found: Add other calendars", { kind: "warn" });
      return false;
    }
    return realClick(add);
  }

  // The main Create split-button. Its text carries the "Create" ligature and it
  // has no aria-label; the lookalike "Create appointment schedule" button does,
  // so exclude it. Clicking the main button opens Google's event editor.
  function createEvent() {
    const btn = Array.from(document.querySelectorAll('button,[role="button"]'))
      .filter(isVisible)
      .find((b) => /create/i.test(b.textContent || "") && !/appointment/i.test(b.getAttribute("aria-label") || ""));
    if (!btn) {
      toast("Calendar control not found: Create", { kind: "warn" });
      return false;
    }
    return realClick(btn);
  }

  function today() {
    const el = document.querySelector(SEL.today);
    if (!el) {
      toast("Calendar control not found: Today", { kind: "warn" });
      return false;
    }
    return realClick(el);
  }

  // The view-switcher: the top-right menu button whose label shows the current
  // view ("Weekarrow_drop_down"). Identified by aria-haspopup=menu + a label
  // that starts with a view name (excludes the Create / Settings menu buttons).
  function viewSwitcher() {
    return (
      Array.from(document.querySelectorAll('button,[role="button"]'))
        .filter(isVisible)
        .find((b) => b.getAttribute("aria-haspopup") === "menu" && VIEW_RE.test((b.textContent || "").trim())) || null
    );
  }

  // Switch the calendar view (Day/Week/Month/…) by driving the view-switcher
  // dropdown: open it, then click the menu item whose text starts with the
  // label (the items read "<View><shortcut>", e.g. "MonthM"). Loud toast on miss.
  function view(label) {
    const switcher = viewSwitcher();
    if (!switcher) {
      toast("Calendar control not found: view switcher", { kind: "warn" });
      return false;
    }
    realClick(switcher);
    return waitFor(
      () =>
        Array.from(document.querySelectorAll('[role="menuitem"],[role="menuitemradio"]'))
          .filter(isVisible)
          .find((e) => (e.textContent || "").trim().startsWith(label)) || null,
      (item) => realClick(item),
      () => toast("Calendar view not found: " + label, { kind: "warn" })
    );
  }

  // The MAIN period-nav button for a direction. Calendar labels it by the
  // current view unit ("Next week", "Next month", …) and renders a duplicate
  // month-nav in the mini-calendar lower in the sidebar, so among the matches
  // we take the topmost (the one in the top toolbar).
  function periodButton(dir) {
    const prefix = dir < 0 ? "Previous" : "Next";
    const btns = Array.from(document.querySelectorAll('button,[role="button"]'))
      .filter(isVisible)
      .filter((b) => {
        const a = b.getAttribute("aria-label") || "";
        return a.indexOf(prefix) === 0 && PERIOD_RE.test(a);
      });
    if (!btns.length) return null;
    btns.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return btns[0];
  }

  function period(dir) {
    const el = periodButton(dir);
    if (!el) {
      toast("Calendar control not found: " + (dir < 0 ? "Previous" : "Next") + " period", { kind: "warn" });
      return false;
    }
    return realClick(el);
  }

  // The signed-in account's email, parsed from the account-switcher aria-label
  // ("Google Account: Name (email)"). Lets the calendar layer label account
  // switch commands and share learned emails with Gmail via storage.
  function accountEmail() {
    const el = document.querySelector(SEL.account);
    const m = el ? (el.getAttribute("aria-label") || "").match(/\(([^)]+@[^)]+)\)/) : null;
    return m ? m[1].trim() : null;
  }

  function switchAccount(n) {
    location.href = `https://calendar.google.com/calendar/u/${n}/r`;
  }

  // The add-calendar settings landing page (Subscribe to calendar, Create new,
  // Browse, From URL) for the CURRENT account. Index is read from the URL, never
  // hardcoded, so it follows whichever account you are in.
  function addCalendarUrl() {
    return `https://calendar.google.com/calendar/u/${accountIndex()}/r/settings/addcalendar`;
  }

  function openAddCalendarPage() {
    location.href = addCalendarUrl();
  }

  // Probe the registry on the current surface; toast a pass/fail summary, log
  // detail. First diagnostic when a calendar key stops working.
  function verifySelectors() {
    const probes = [
      { probe: "My calendars list", ok: !!document.querySelector(SEL.myCalendars) },
      { probe: "Other calendars list", ok: !!document.querySelector(SEL.otherCalendars) },
      { probe: "calendar toggles", ok: calendars().length > 0 },
      { probe: "Add other calendars (+)", ok: !!document.querySelector(SEL.addOther) },
      { probe: "view switcher", ok: !!viewSwitcher() },
      { probe: "period nav", ok: !!periodButton(1) },
      { probe: "Today", ok: !!document.querySelector(SEL.today) },
    ];
    const failed = probes.filter((p) => !p.ok);
    if (typeof console !== "undefined" && console.table) console.table(probes);
    toast(failed.length ? `Calendar selectors missing: ${failed.map((f) => f.probe).join(", ")}` : "Calendar selectors OK", {
      kind: failed.length ? "warn" : "info",
    });
    return { probes, failed };
  }

  InboxKeys.gcal = {
    SEL,
    isVisible,
    realClick,
    waitFor,
    accountIndex,
    calendars,
    findCalendar,
    setShown,
    toggle,
    showAll,
    focusOnly,
    addByUrl,
    openAddMenu,
    addCalendarUrl,
    openAddCalendarPage,
    createEvent,
    today,
    view,
    period,
    accountEmail,
    switchAccount,
    setControlledValue,
    verifySelectors,
  };
})();
