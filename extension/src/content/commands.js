// The command registry: every action the palette and hotkeys can run.
// Each command: { id, title, group, hint?, keys, contexts, run() }.
// `keys` is derived from CMDK_KEYMAP.keysFor(id, keyOverrides); "g i" is a chord
// (press g then i). `contexts` comes from the shared catalog.
window.CMDK = window.CMDK || {};

(function () {
  const { gmail, accounts, calendar, tabs, storage } = CMDK;

  function nav(hash) {
    return () => gmail.setHash(hash);
  }

  // Pull keys + contexts for a catalog command id, applying user overrides.
  function entry(id) {
    return (CMDK_KEYMAP.commands || []).find((c) => c.id === id) || null;
  }
  function keysFor(id) {
    return CMDK_KEYMAP.keysFor(id, storage.get("keyOverrides") || {});
  }
  function contextsFor(id) {
    const e = entry(id);
    return e ? e.contexts : CMDK_KEYMAP.DEFAULT_CONTEXTS;
  }
  // Build a base command from a catalog id: catalog supplies title/group/keys/
  // contexts; the caller supplies run() and an optional hint override.
  function cmd(id, run, hint) {
    const e = entry(id);
    return {
      id,
      title: e ? e.title : id,
      group: e ? e.group : "",
      hint,
      keys: keysFor(id),
      contexts: contextsFor(id),
      run,
    };
  }

  // Rebuilt each time the palette opens so key overrides stay current.
  function buildBase() {
    return [
      // Compose / messaging
      cmd("compose", () => gmail.compose()),
      cmd("reply", () => gmail.replyToThread()),
      cmd("reply-all", () => gmail.replyAllToThread()),
      cmd("forward", () => gmail.forwardThread()),

      // Triage (archive is context-aware: open thread vs. selected/cursor rows)
      cmd("archive", () => (gmail.getContext() === "threadView" ? gmail.archiveThread() : CMDK.listnav.archive())),
      cmd("delete", () => gmail.action(["Delete"], "#")),
      cmd("mark-read", () => gmail.action(["Mark as read"])),
      cmd("mark-unread", () => gmail.action(["Mark as unread"])),
      cmd("snooze", () => gmail.action(["Snooze"], "b")),
      cmd("report-spam", () => gmail.action(["Report spam"], "!")),
      cmd("star", () => gmail.action(["Add star", "Remove star"], "s")),

      // Navigation (chords mirror Gmail's "g" prefix)
      cmd("go-inbox", nav("inbox")),
      cmd("go-sent", nav("sent")),
      cmd("go-drafts", nav("drafts")),
      cmd("go-starred", nav("starred")),
      cmd("go-snoozed", nav("snoozed")),
      cmd("go-important", nav("imp")),
      cmd("go-all", nav("all")),
      cmd("go-spam", nav("spam")),
      cmd("go-trash", nav("trash")),
      cmd("go-settings", nav("settings/general")),

      // List scrolling + thread/tab navigation (engine helpers)
      cmd("go-top", () => gmail.listScrollTop()),
      cmd("go-bottom", () => gmail.listScrollBottom()),
      cmd("next-tab", () => tabs.next()),
      cmd("prev-tab", () => tabs.prev()),
      cmd("back-to-list", () => gmail.back()),
      { id: "next-thread", title: "Next conversation", group: "Navigation", hint: "← / →", keys: [], contexts: ["threadView"], run: () => gmail.nextThread() },
      { id: "prev-thread", title: "Previous conversation", group: "Navigation", hint: "← / →", keys: [], contexts: ["threadView"], run: () => gmail.prevThread() },
      { id: "expand-all", title: "Expand / collapse all messages", group: "Navigation", hint: ";", keys: [], contexts: ["threadView"], run: () => CMDK.threadnav.expandAllToggle() },

      // Calendar (the 0 / 0 0 keys are special-cased in hotkeys.js; these rows
      // surface them in the palette with a hint).
      cmd("calendar-half", () => calendar.open("side"), "0"),
      cmd("calendar-tab", () => calendar.open("tab"), "0 0"),

      // Search
      cmd("search", () => {
        const box = document.querySelector('input[aria-label="Search mail"], input[name="q"]');
        if (box) {
          if (CMDK.hotkeys && CMDK.hotkeys.armSearchEditing) CMDK.hotkeys.armSearchEditing();
          box.focus();
        } else {
          gmail.setHash("search/");
        }
      }),
    ];
  }

  // Split-inbox tabs: a "Go to <tab>" row per saved tab, plus the config opener.
  function tabCommands() {
    const list = (tabs && tabs.list && tabs.list()) || [];
    const cmds = list.map((tab) => ({
      id: `tab-${tab.id}`,
      title: `Go to tab: ${tab.name}`,
      hint: tab.type === "inbox" ? "Inbox" : tab.query,
      group: "Tabs",
      keys: [],
      contexts: CMDK_KEYMAP.DEFAULT_CONTEXTS,
      run: () => tabs.navigate(tab),
    }));
    cmds.push({
      id: "tabs-config",
      title: "Configure split inbox tabs…",
      group: "Tabs",
      keys: [],
      contexts: CMDK_KEYMAP.DEFAULT_CONTEXTS,
      run: () => tabs.openConfig(),
    });
    return cmds;
  }

  // Account switching: g 0 / g 1 / g 2 … map to /mail/u/N. The engine binds
  // g 0–g 8 unconditionally (hotkeys.js), so every signed-in account is reachable
  // by keyboard immediately. Here we just surface them in the palette: every
  // account we've learned the email for, plus a couple of "next" slots so the
  // unvisited ones are still discoverable. Emails fill in as you visit each.
  function accountCommands() {
    const cur = gmail.accountIndex();
    const names = storage.get("accountNames") || {};
    const known = accounts.known();
    const highest = known.reduce((m, a) => Math.max(m, a.index), cur);
    // Every configured/learned account, plus a couple of unvisited slots so they
    // stay discoverable. Configure the full list (emails) from "Configure accounts…".
    const maxIdx = Math.min(8, Math.max(2, highest));
    const indices = [];
    for (let i = 0; i <= maxIdx; i++) indices.push(i);
    const rows = indices.map((index) => {
      const email = names[String(index)];
      return {
        id: `acct-${index}`,
        title: email ? `Switch to ${email}` : `Switch to account u/${index}`,
        hint: index === cur ? "current" : `g ${index}`,
        group: "Accounts",
        keys: [`g ${index}`],
        contexts: CMDK_KEYMAP.DEFAULT_CONTEXTS,
        run: () => accounts.switchTo(index),
      };
    });
    rows.push({
      id: "accounts-config",
      title: "Configure accounts…",
      group: "Accounts",
      keys: [],
      contexts: CMDK_KEYMAP.DEFAULT_CONTEXTS,
      run: () => accounts.openConfig(),
    });
    return rows;
  }

  // Built fresh each time the palette opens so tab/account/override state is current.
  function all() {
    return [...buildBase(), ...tabCommands(), ...accountCommands(), ...extra];
  }

  // Allow late registration (e.g. from custom user config later).
  const extra = [];
  function register(cmd) {
    extra.push(cmd);
  }

  function byKeys() {
    const map = [];
    for (const cmd of all()) {
      for (const k of cmd.keys || []) map.push({ keys: k, cmd, contexts: cmd.contexts });
    }
    return map;
  }

  // `base` is kept as a getter so callers always see current overrides applied.
  CMDK.commands = {
    all,
    register,
    byKeys,
    get base() {
      return buildBase();
    },
  };
})();
