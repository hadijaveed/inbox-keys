// The in-calendar layer UI: a Cmd+K overlay for controlling calendar LAYERS
// (toggle / focus / show all), switching accounts, and adding more sources;
// a curated set of single keys for navigation/create; plus a persistent,
// dismissible nudge that keeps prompting you to add another account or an
// Outlook/iCal feed to your unified view.
//
// Two key surfaces, by design:
//  - Cmd+K owns what Calendar has NO shortcut for: per-calendar layer
//    visibility, account switching, and adding sources.
//  - Single keys (c/t/j/k/d/w/m) mirror Calendar's own navigation/create, but
//    we capture and consume them and drive the real control via realClick, so
//    each fires exactly once and works whether or not Calendar's native
//    shortcuts are enabled. They are suppressed while typing or while our
//    overlay owns the keyboard.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const { gcal } = InboxKeys;
  if (!gcal) return; // only runs where the calendar driver loaded
  const storage = InboxKeys.storage;
  const PREFIX = "inboxkeys-gcal";

  // ---- command model (pure, unit-tested) --------------------------------

  // The list of actions the overlay offers, derived from the live rail. Adding
  // sources comes first so "keep adding more" is always the top of the list.
  // "Go to" commands for switching the calendar to another signed-in account
  // (/calendar/u/N), labelled by email when known. Emails are shared with Gmail
  // through storage.accountNames, so accounts Gmail already learned show here.
  function accountSwitchCommands() {
    const names = (storage && storage.get("accountNames")) || {};
    const cur = gcal.accountIndex();
    // accountNames is shared with Gmail, where the MAIN-world bridge enumerates
    // the real signed-in account list from the OneGoogle bar. So once Gmail has
    // been open, we know every account's email here too — show exactly those, no
    // useless "account u/N" placeholders. Before any account is known (cold start
    // on a machine where Gmail hasn't loaded yet), fall back to the g 0–g 8 slots
    // so switching still works.
    const known = Object.keys(names)
      .map(Number)
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b);
    let indices;
    if (known.length >= 2) {
      indices = known;
    } else {
      indices = [];
      for (let i = 0; i <= 8; i++) indices.push(i);
    }
    const cmds = [];
    for (const i of indices) {
      if (i === cur) continue;
      const email = names[String(i)];
      cmds.push({
        id: "acct:" + i,
        title: email ? `Switch to ${email}` : `Switch to calendar account u/${i}`,
        kind: "go",
        run: () => gcal.switchAccount(i),
      });
    }
    return cmds;
  }

  function calendarCommands() {
    const cals = gcal.calendars();
    const cmds = [
      { id: "add-google", title: "Add a Gmail or Google calendar", kind: "add", run: addGoogle },
      { id: "add-ics", title: "Add an Outlook or iCal calendar (paste link)", kind: "add", run: promptIcs },
      ...accountSwitchCommands(),
      { id: "show-all", title: "Show all calendars", kind: "layer", run: () => gcal.showAll() },
    ];
    for (const c of cals) {
      cmds.push({
        id: "toggle:" + c.name,
        title: (c.checked ? "Hide " : "Show ") + c.name,
        kind: "layer",
        run: () => gcal.toggle(c.name),
      });
      cmds.push({ id: "focus:" + c.name, title: "Focus only " + c.name, kind: "layer", run: () => gcal.focusOnly(c.name) });
    }
    cmds.push({ id: "today", title: "Go to today", kind: "nav", key: "t", run: () => gcal.today() });
    cmds.push({ id: "prev", title: "Go back (previous)", kind: "nav", key: "←", run: () => gcal.period(-1) });
    cmds.push({ id: "next", title: "Go forward (next)", kind: "nav", key: "→", run: () => gcal.period(1) });
    cmds.push({ id: "view-day", title: "Go to day view", kind: "nav", key: "d", run: () => gcal.view("Day") });
    cmds.push({ id: "view-week", title: "Go to week view", kind: "nav", key: "w", run: () => gcal.view("Week") });
    cmds.push({ id: "view-month", title: "Go to month view", kind: "nav", key: "m", run: () => gcal.view("Month") });
    cmds.push({ id: "create", title: "Create event", kind: "nav", key: "c", run: () => gcal.createEvent() });
    return cmds;
  }

  // Substring (token) filter over command titles; empty query returns all.
  function filterCommands(cmds, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return cmds;
    const tokens = q.split(/\s+/);
    return cmds.filter((c) => {
      const t = c.title.toLowerCase();
      return tokens.every((tok) => t.includes(tok));
    });
  }

  // ---- actions -----------------------------------------------------------

  // Adding another Google account: open Google's OWN "Subscribe to calendar"
  // pane in a NEW tab (its addcalendar URL for the current account), and keep
  // THIS tab open with a persistent education panel — add the email there, get
  // the permission email, then come back and press Refresh. We don't steer
  // Google's box ourselves (sturdier), and our own input never appears, so
  // password managers have nothing to grab.
  function addGoogle() {
    const url = gcal.addCalendarUrl();
    window.open(url, "_blank"); // subscribe UI in a new tab
    showGuide({
      persist: true, // must survive the focus change when the new tab opens
      title: "Add a Gmail or Google calendar",
      lead: "We opened Google's “Subscribe to calendar” in a new tab. Add the calendar there, then come back to THIS tab and press Refresh.",
      steps: [
        "In the new tab, type the email of the calendar you want to add.",
        "If it is not already shared with you, that account gets a permission email to approve.",
        "Once it is approved (or if it was already shared), come back to this tab.",
        "Press “Refresh” below — the calendar appears under “Other calendars”.",
      ],
      note: "Keep this tab open. Approval can take a moment; just press Refresh after it is granted.",
      buttons: [
        { label: "Refresh now", primary: true, onClick: () => location.reload() },
        { label: "Open subscribe page", onClick: () => window.open(url, "_blank") },
      ],
    });
  }

  // Adding an OUTLOOK (or any iCal) calendar: Outlook hands you a private link;
  // you paste it once and Calendar subscribes. Numbered Outlook publish steps
  // above the box, with a one-line "what you're doing" lead.
  function promptIcs() {
    openInput({
      title: "Add an Outlook or iCal calendar",
      lead: "What this does: Outlook gives your calendar a private link. Paste it once and your Outlook events show up here under “Other calendars”.",
      steps: [
        "In Outlook on the web, open Calendar, then click the gear (Settings) at the top right.",
        "Go to “Calendar”, then “Shared calendars”.",
        "Under “Publish a calendar”, pick the calendar, choose “Can view all details”, then click “Publish”.",
        "Two links appear. Copy the one that ENDS IN .ics (the ICS link, not the HTML one).",
        "Paste it below and press Enter.",
      ],
      note: "Outlook feeds refresh every few hours, not instantly. If there is no “Publish a calendar”, a work admin turned it off. The link is private, so treat it like a password.",
      placeholder: "https://outlook.office365.com/owa/calendar/…/calendar.ics",
      buttons: [{ label: "Add calendar", primary: true, submit: true }],
      onSubmit: (url) => {
        const u = (url || "").trim();
        if (!u) return;
        gcal.addByUrl(u);
        rememberFeed(u);
      },
    });
  }

  function rememberFeed(url) {
    if (!storage) return;
    const feeds = (storage.get("calendarFeeds") || []).slice();
    if (!feeds.includes(url)) {
      feeds.push(url);
      storage.set({ calendarFeeds: feeds });
    }
  }

  // ---- overlay UI --------------------------------------------------------

  let overlay = null;
  let inputOverlay = null;

  function ensureStyles() {
    if (document.getElementById(PREFIX + "-style")) return;
    const css = `
      .${PREFIX}-overlay{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,.4)}
      .${PREFIX}-panel{margin-top:12vh;width:560px;max-width:92vw;background:#1f1f24;color:#f2f2f4;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif}
      .${PREFIX}-search{width:100%;box-sizing:border-box;padding:16px 18px;font-size:16px;border:0;outline:0;background:#2a2a31;color:#fff}
      .${PREFIX}-list{max-height:50vh;overflow:auto;margin:0;padding:6px 0;list-style:none}
      .${PREFIX}-item{padding:10px 18px;font-size:14px;cursor:pointer;display:flex;gap:10px;align-items:center}
      .${PREFIX}-item.${PREFIX}-active{background:#3a3a45}
      .${PREFIX}-badge{font-size:11px;color:#a6a6ad;border:1px solid #4a4a55;border-radius:6px;padding:1px 6px;margin-left:auto}
      .${PREFIX}-kbd{margin-left:auto;font:11px ui-monospace,Menlo,Consolas,monospace;color:#cfcfd6;background:#17171b;border:1px solid #4a4a55;border-radius:5px;padding:2px 8px;min-width:12px;text-align:center;text-transform:uppercase}
      .${PREFIX}-hint{padding:8px 18px;font-size:12px;color:#a6a6ad}
      .${PREFIX}-title{padding:16px 18px 4px;font-size:15px;color:#f2f2f4;font-weight:600}
      .${PREFIX}-steps{margin:4px 0 6px;padding:0 18px 0 36px;color:#cfcfd6;font-size:13px;line-height:1.65}
      .${PREFIX}-steps li{margin:3px 0}
      .${PREFIX}-note{padding:4px 18px 12px;font-size:12px;color:#a6a6ad;line-height:1.5}
      .${PREFIX}-lead{padding:2px 18px 10px;font-size:13px;color:#d7d7de;line-height:1.55}
      .${PREFIX}-btnrow{display:flex;gap:8px;justify-content:flex-end;padding:6px 16px 16px}
      .${PREFIX}-btnrow button{cursor:pointer;border:0;border-radius:7px;padding:7px 12px;font-size:13px}
      .${PREFIX}-nudge{position:fixed;left:16px;bottom:16px;z-index:2147483500;background:#1f1f24;color:#f2f2f4;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);padding:10px 12px;font:13px -apple-system,'Helvetica Neue',Arial,sans-serif;display:flex;gap:10px;align-items:center}
      .${PREFIX}-nudge b{color:#7C7FF6}
      .${PREFIX}-nudge button{cursor:pointer;border:0;border-radius:7px;padding:6px 10px;font-size:13px}
      .${PREFIX}-add{background:#7C7FF6;color:#fff}
      .${PREFIX}-x{background:transparent;color:#a6a6ad}
    `;
    const style = document.createElement("style");
    style.id = PREFIX + "-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function closeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function closeInput() {
    if (inputOverlay) {
      inputOverlay.remove();
      inputOverlay = null;
    }
  }

  // Stop password managers (1Password, LastPass, Bitwarden, Dashlane, Chrome)
  // from treating our text boxes as login fields and popping an autofill menu
  // over the palette. Our inputs are a command filter and a URL box, never
  // credentials, so we opt out explicitly via the attributes each one honors.
  function hardenField(input) {
    input.type = "text";
    input.name = "inboxkeys-field";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("data-1p-ignore", "true");
    input.setAttribute("data-lpignore", "true");
    input.setAttribute("data-bwignore", "true");
    input.setAttribute("data-form-type", "other");
  }

  // Close an overlay as soon as focus leaves it. This is the reliable Escape
  // path on Calendar: its window-level capture handler swallows the first
  // Escape to blur our focused text field (so our keydown handler never sees
  // it), but that blur moves focus out of our overlay, which we DO catch here,
  // closing on a single press. relatedTarget is the element gaining focus;
  // when it is null we re-check the active element on the next tick.
  function bindAutoClose(el, close) {
    el.addEventListener("focusout", (e) => {
      if (e.relatedTarget) {
        if (!el.contains(e.relatedTarget)) close();
        return;
      }
      setTimeout(() => {
        if (el.isConnected && !el.contains(document.activeElement)) close();
      }, 0);
    });
  }

  function openOverlay() {
    ensureStyles();
    closeOverlay();
    const cmds = calendarCommands();
    overlay = document.createElement("div");
    overlay.className = `${PREFIX}-overlay`;
    const panel = document.createElement("div");
    panel.className = `${PREFIX}-panel`;
    const search = document.createElement("input");
    search.className = `${PREFIX}-search`;
    search.placeholder = "Calendar layers and sources…";
    hardenField(search);
    const list = document.createElement("ul");
    list.className = `${PREFIX}-list`;
    panel.appendChild(search);
    panel.appendChild(list);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let active = 0;
    let shown = cmds;

    function render() {
      shown = filterCommands(cmds, search.value);
      if (active >= shown.length) active = Math.max(0, shown.length - 1);
      list.textContent = "";
      shown.forEach((c, i) => {
        const li = document.createElement("li");
        li.className = `${PREFIX}-item` + (i === active ? ` ${PREFIX}-active` : "");
        const label = document.createElement("span");
        label.textContent = c.title;
        li.appendChild(label);
        if (c.kind === "add") {
          const b = document.createElement("span");
          b.className = `${PREFIX}-badge`;
          b.textContent = "add";
          li.appendChild(b);
        }
        // Show the single-key shortcut (t/d/w/m/c) so it is discoverable.
        if (c.key) {
          const k = document.createElement("kbd");
          k.className = `${PREFIX}-kbd`;
          k.textContent = c.key;
          li.appendChild(k);
        }
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          exec(i);
        });
        list.appendChild(li);
      });
      // Keep the highlighted row in view so arrowing to the top/bottom tracks.
      const activeLi = list.children[active];
      if (activeLi && activeLi.scrollIntoView) activeLi.scrollIntoView({ block: "nearest" });
    }

    function exec(i) {
      const c = shown[i];
      closeOverlay();
      if (c && typeof c.run === "function") c.run();
    }

    search.addEventListener("input", render);
    search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        active = Math.min(active + 1, shown.length - 1);
        render();
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        active = Math.max(active - 1, 0);
        render();
        e.preventDefault();
      } else if (e.key === "Enter") {
        exec(active);
        e.preventDefault();
      } else if (e.key === "Escape") {
        closeOverlay();
        e.preventDefault();
      }
    });
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeOverlay();
    });
    bindAutoClose(overlay, closeOverlay);
    render();
    search.focus();
  }

  // A single-field input overlay with optional numbered instructions: a plain
  // one-line "what you're doing" lead, the steps, a note, the field, then an
  // optional row of action buttons. A button with `submit:true` runs onSubmit
  // with the current field value (same as pressing Enter); others run onClick.
  function openInput({ title, lead, steps, note, placeholder, buttons, onSubmit }) {
    ensureStyles();
    if (inputOverlay) inputOverlay.remove();
    inputOverlay = document.createElement("div");
    inputOverlay.className = `${PREFIX}-overlay`;
    const panel = document.createElement("div");
    panel.className = `${PREFIX}-panel`;
    const h = document.createElement("div");
    h.className = `${PREFIX}-title`;
    h.textContent = title;
    panel.appendChild(h);
    if (lead) {
      const l = document.createElement("div");
      l.className = `${PREFIX}-lead`;
      l.textContent = lead;
      panel.appendChild(l);
    }
    if (Array.isArray(steps) && steps.length) {
      const ol = document.createElement("ol");
      ol.className = `${PREFIX}-steps`;
      for (const s of steps) {
        const li = document.createElement("li");
        li.textContent = s;
        ol.appendChild(li);
      }
      panel.appendChild(ol);
    }
    if (note) {
      const n = document.createElement("div");
      n.className = `${PREFIX}-note`;
      n.textContent = note;
      panel.appendChild(n);
    }
    const input = document.createElement("input");
    input.className = `${PREFIX}-search`;
    input.placeholder = placeholder || "";
    hardenField(input);
    panel.appendChild(input);
    const close = closeInput;
    function doSubmit() {
      const v = input.value;
      close();
      if (onSubmit) onSubmit(v);
    }
    if (Array.isArray(buttons) && buttons.length) {
      const row = document.createElement("div");
      row.className = `${PREFIX}-btnrow`;
      for (const b of buttons) {
        const btn = document.createElement("button");
        btn.className = `${PREFIX}-` + (b.primary ? "add" : "x");
        btn.textContent = b.label;
        btn.addEventListener("click", () => {
          if (b.submit) {
            doSubmit();
            return;
          }
          close();
          if (b.onClick) b.onClick();
        });
        row.appendChild(btn);
      }
      panel.appendChild(row);
    }
    inputOverlay.appendChild(panel);
    document.body.appendChild(inputOverlay);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        doSubmit();
        e.preventDefault();
      } else if (e.key === "Escape") {
        close();
        e.preventDefault();
      }
    });
    inputOverlay.addEventListener("mousedown", (e) => {
      if (e.target === inputOverlay) close();
    });
    bindAutoClose(inputOverlay, close);
    input.focus();
  }

  // A read-only instructions panel (a plain "what you're doing" lead, numbered
  // steps, a note, then a row of action buttons). With `persist`, it does NOT
  // close on focus-out — required when the action opens a NEW tab (which blurs
  // this one), so the education panel stays put for the user to return to.
  function showGuide({ title, lead, steps, note, buttons, persist }) {
    ensureStyles();
    closeInput();
    inputOverlay = document.createElement("div");
    inputOverlay.className = `${PREFIX}-overlay`;
    const panel = document.createElement("div");
    panel.className = `${PREFIX}-panel`;
    const h = document.createElement("div");
    h.className = `${PREFIX}-title`;
    h.textContent = title;
    panel.appendChild(h);
    if (lead) {
      const l = document.createElement("div");
      l.className = `${PREFIX}-lead`;
      l.textContent = lead;
      panel.appendChild(l);
    }
    if (Array.isArray(steps) && steps.length) {
      const ol = document.createElement("ol");
      ol.className = `${PREFIX}-steps`;
      for (const s of steps) {
        const li = document.createElement("li");
        li.textContent = s;
        ol.appendChild(li);
      }
      panel.appendChild(ol);
    }
    if (note) {
      const n = document.createElement("div");
      n.className = `${PREFIX}-note`;
      n.textContent = note;
      panel.appendChild(n);
    }
    const row = document.createElement("div");
    row.className = `${PREFIX}-btnrow`;
    for (const b of buttons || []) {
      const btn = document.createElement("button");
      btn.className = `${PREFIX}-` + (b.primary ? "add" : "x");
      btn.textContent = b.label;
      btn.addEventListener("click", () => {
        closeInput();
        if (b.onClick) b.onClick();
      });
      row.appendChild(btn);
    }
    panel.appendChild(row);
    inputOverlay.appendChild(panel);
    document.body.appendChild(inputOverlay);
    inputOverlay.addEventListener("mousedown", (e) => {
      if (e.target === inputOverlay) closeInput();
    });
    if (!persist) bindAutoClose(inputOverlay, closeInput);
    const first = row.querySelector("button");
    if (first && first.focus) first.focus();
  }

  // ---- persistent "keep adding" nudge -----------------------------------

  function renderNudge() {
    if (document.getElementById(PREFIX + "-nudge")) return;
    if (storage && storage.get("calendarNudgeDismissed")) return;
    ensureStyles();
    const count = gcal.calendars().length;
    const bar = document.createElement("div");
    bar.id = PREFIX + "-nudge";
    bar.className = `${PREFIX}-nudge`;
    const text = document.createElement("span");
    const strong = document.createElement("b");
    strong.textContent = "Unified calendar";
    text.appendChild(strong);
    text.appendChild(document.createTextNode(` · ${count} calendar${count === 1 ? "" : "s"}`));
    const add = document.createElement("button");
    add.className = `${PREFIX}-add`;
    add.textContent = "+ Add account or Outlook feed";
    add.addEventListener("click", openOverlay);
    const x = document.createElement("button");
    x.className = `${PREFIX}-x`;
    x.textContent = "Dismiss";
    x.addEventListener("click", () => {
      bar.remove();
      if (storage) storage.set({ calendarNudgeDismissed: true });
    });
    bar.appendChild(text);
    bar.appendChild(add);
    bar.appendChild(x);
    document.body.appendChild(bar);
  }

  // ---- bootstrap ---------------------------------------------------------

  function isTyping(el) {
    if (!el || typeof el.tagName !== "string") return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
  }

  // Curated single keys that drive Calendar's own controls through realClick.
  // We own them (capture phase + consume), so the action fires exactly once
  // whether or not Calendar's native shortcuts are enabled, and the outcome is
  // identical to Calendar's own key since we click the same control.
  const KEY_ACTIONS = {
    c: () => gcal.createEvent(),
    t: () => gcal.today(),
    // Left/Right arrows move back/forward a period, mirroring the on-screen
    // ‹ › buttons; the vertical arrows are left alone so scrolling still works.
    arrowleft: () => gcal.period(-1),
    arrowright: () => gcal.period(1),
    j: () => gcal.period(1),
    k: () => gcal.period(-1),
    d: () => gcal.view("Day"),
    w: () => gcal.view("Week"),
    m: () => gcal.view("Month"),
  };

  function onKeydown(e) {
    const mod = e.metaKey || e.ctrlKey;
    const key = (e.key || "").toLowerCase();
    if (mod && key === "k") {
      // Don't steal a browser/site Cmd+K from a focused text field other than ours.
      if (overlay) {
        closeOverlay();
      } else {
        openOverlay();
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // When our overlay or input is open, own Escape at the document level so it
    // always closes. The overlay's own input listener (bubble phase) can be
    // pre-empted by Calendar's own Escape handler; this capture-phase handler
    // is the one we know fires (Cmd+K opens through it).
    if ((overlay || inputOverlay) && e.key === "Escape") {
      closeOverlay();
      closeInput();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    // Single-key shortcuts only: no modifiers, not while typing, not while our
    // own overlay/input owns the keyboard, and not Shift-chorded.
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (overlay || inputOverlay) return;
    if (isTyping(e.target)) return;
    // If Calendar's own shortcuts are enabled, its window-level handler runs
    // before ours and already preventDefault'd the key; defer so we never
    // double-act (e.g. advance the period twice on j/k).
    if (e.defaultPrevented) return;
    const action = KEY_ACTIONS[key];
    if (action) {
      action();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  // Record this account's email (parsed from the account switcher) into the
  // shared accountNames map so the switch-account commands can label it, and so
  // Gmail and Calendar learn each other's accounts.
  function learnAccount() {
    if (!storage) return;
    const email = gcal.accountEmail();
    if (!email) return;
    const idx = gcal.accountIndex();
    const names = Object.assign({}, storage.get("accountNames") || {});
    if (names[String(idx)] !== email) {
      names[String(idx)] = email;
      storage.set({ accountNames: names });
    }
  }

  function init() {
    document.addEventListener("keydown", onKeydown, true);
    // The rail renders a beat after the grid; wait for it, then nudge + learn.
    gcal.waitFor(
      () => (gcal.calendars().length ? true : null),
      () => {
        renderNudge();
        learnAccount();
      },
      () => {}
    );
  }

  function boot() {
    if (storage && storage.load) {
      storage.load().then(init, init);
    } else {
      init();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  InboxKeys.gcalui = { calendarCommands, filterCommands, openOverlay, renderNudge, onKeydown };
})();
