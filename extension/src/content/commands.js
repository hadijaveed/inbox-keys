// The command registry: every action the palette and hotkeys can run.
// Each command: { id, title, group, hint?, keys, contexts, run() }.
// `keys` is derived from InboxKeys_KEYMAP.keysFor(id, keyOverrides); "g i" is a chord
// (press g then i). `contexts` comes from the shared catalog.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const { gmail, accounts, calendar, tabs, storage } = InboxKeys;

  function nav(hash) {
    return () => gmail.setHash(hash);
  }

  // Pull keys + contexts for a catalog command id, applying user overrides.
  function entry(id) {
    return (InboxKeys_KEYMAP.commands || []).find((c) => c.id === id) || null;
  }
  function keysFor(id) {
    return InboxKeys_KEYMAP.keysFor(id, storage.get("keyOverrides") || {});
  }
  function contextsFor(id) {
    const e = entry(id);
    return e ? e.contexts : InboxKeys_KEYMAP.DEFAULT_CONTEXTS;
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

  function listSelectionAction(action) {
    if (gmail.getContext() === "inboxList" && InboxKeys.listnav && InboxKeys.listnav.withSelection) {
      return InboxKeys.listnav.withSelection(action);
    }
    return action();
  }

  function listTemporarySelectionAction(action) {
    if (gmail.getContext() === "inboxList" && InboxKeys.listnav && InboxKeys.listnav.withTemporarySelection) {
      return InboxKeys.listnav.withTemporarySelection(action);
    }
    return action();
  }

  // Rebuilt each time the palette opens so key overrides stay current.
  function buildBase() {
    return [
      // Compose / messaging
      cmd("compose", () => gmail.compose()),
      cmd("reply", () => gmail.replyToThread()),
      cmd("reply-all", () => gmail.replyAllToThread(InboxKeys.threadnav.currentCard() || document)),
      cmd("forward", () => gmail.forwardThread()),
      cmd("open-link-or-attachment", () => gmail.openLinkOrAttachment(InboxKeys.threadnav.currentCard() || document)),
      cmd("attach-file", () => gmail.attachFile()),
      cmd("discard-draft", () => gmail.discardDraft()),

      // Triage (archive is context-aware: open thread vs. selected/cursor rows)
      cmd("archive", () => (gmail.getContext() === "threadView" ? gmail.archiveThread() : InboxKeys.listnav.archive())),
      cmd("mark-not-done", () => listSelectionAction(() => gmail.markNotDone())),
      cmd("delete", () => (gmail.getContext() === "threadView" ? gmail.action(["Delete"], "Delete") : InboxKeys.listnav.trash())),
      cmd("undo", () => gmail.undo()),
      cmd("mark-read-unread", () => (gmail.getContext() === "inboxList" ? InboxKeys.listnav.markReadUnread() : gmail.markReadUnread())),
      cmd("mark-read", () => gmail.action(["Mark as read"])),
      cmd("mark-unread", () => gmail.action(["Mark as unread"])),
      cmd("snooze", () => (gmail.getContext() === "inboxList" ? InboxKeys.listnav.snooze() : gmail.snooze())),
      cmd("report-spam", () => gmail.action(["Report spam"])),
      cmd("star", () => (gmail.getContext() === "threadView" ? gmail.toggleStar(InboxKeys.threadnav.currentCard() || document) : InboxKeys.listnav.toggleStar())),
      cmd("mute", () => listSelectionAction(() => gmail.mute())),
      cmd("unsubscribe", () => gmail.unsubscribe()),
      cmd("label", () => listSelectionAction(() => gmail.openLabelMenu())),
      cmd("remove-label", () => listSelectionAction(() => gmail.removeLabel())),
      cmd("remove-all-labels", () => listSelectionAction(() => gmail.removeAllLabels())),
      cmd("move", () => listSelectionAction(() => gmail.openMoveMenu())),

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
      cmd("go-top", () => {
        gmail.listScrollTop();
        if (InboxKeys.listnav && InboxKeys.listnav.syncEdgeAfterScroll) InboxKeys.listnav.syncEdgeAfterScroll(-1);
      }),
      cmd("go-bottom", () => {
        gmail.listScrollBottom();
        if (InboxKeys.listnav && InboxKeys.listnav.syncEdgeAfterScroll) InboxKeys.listnav.syncEdgeAfterScroll(1);
      }),
      cmd("expand-message", () => InboxKeys.threadnav.toggleFocused()),
      cmd("expand-all", () => InboxKeys.threadnav.expandAllToggle()),
      cmd("next-page", () => InboxKeys.listnav.page(1)),
      cmd("prev-page", () => InboxKeys.listnav.page(-1)),
      cmd("next-tab", () => tabs.next()),
      cmd("prev-tab", () => tabs.prev()),
      cmd("back-to-list", () => gmail.back()),
      { id: "next-thread", title: "Next conversation", group: "Navigation", hint: "← / →", keys: [], contexts: ["threadView"], run: () => gmail.nextThread() },
      { id: "prev-thread", title: "Previous conversation", group: "Navigation", hint: "← / →", keys: [], contexts: ["threadView"], run: () => gmail.prevThread() },

      // Calendar (the 0 / 0 0 keys are special-cased in hotkeys.js; these rows
      // surface them in the palette with a hint).
      cmd("calendar-half", () => calendar.open("side"), "0"),
      cmd("calendar-tab", () => calendar.open("tab"), "0 0"),

      // Search
      cmd("search", () => {
        const box = document.querySelector(gmail.SEL.searchInput);
        if (box) {
          if (InboxKeys.hotkeys && InboxKeys.hotkeys.armSearchEditing) InboxKeys.hotkeys.armSearchEditing();
          box.focus();
        } else {
          gmail.setHash("search/");
        }
      }),
    ];
  }

  // Split-inbox tabs: a "Go to <tab>" row per saved tab.
  function tabCommands() {
    const list = (tabs && tabs.list && tabs.list()) || [];
    return list.map((tab) => ({
      id: `tab-${tab.id}`,
      title: `Go to tab: ${tab.name}`,
      hint: tab.type === "inbox" ? "Inbox" : tab.query,
      group: "Tabs",
      keys: [],
      contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
      run: () => tabs.navigate(tab),
    }));
  }

  function settingsCommands() {
    return [
      {
        id: "inboxkeys-settings",
        title: "InboxKeys settings...",
        group: "Settings",
        keys: [],
        contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
        run: () => tabs.openConfig("tabs"),
      },
      {
        id: "tabs-config",
        title: "Configure split inbox tabs...",
        group: "Settings",
        keys: [],
        contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
        run: () => tabs.openConfig("tabs"),
      },
      {
        id: "shortcuts-config",
        title: "Configure keyboard shortcuts...",
        group: "Settings",
        keys: [],
        contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
        run: () => tabs.openConfig("shortcuts"),
      },
      {
        // In-Gmail smoke probe over gmail.SEL: run when a shortcut stops
        // working — the toast/console name exactly which Gmail hook moved.
        id: "verify-selectors",
        title: "Verify Gmail selectors (smoke check)",
        group: "Settings",
        keys: [],
        contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
        run: () => gmail.verifySelectors(),
      },
    ];
  }

  // Account switching: g 0 / g 1 / g 2 … map to /mail/u/N. The engine binds
  // g 0–g 8 unconditionally (hotkeys.js), so every signed-in account is reachable
  // by keyboard immediately. The MAIN-world bridge enumerates the real signed-in
  // account list from the OneGoogle bar (account-bridge.js → account-sync.js →
  // accountNames), so once it has run we know every account's email.
  function accountCommands() {
    const cur = gmail.accountIndex();
    const names = storage.get("accountNames") || {};
    const known = accounts.known();
    // Show exactly the accounts we know — every row carries an email, no useless
    // "account u/N" placeholders. Before enumeration lands (cold start), fall back
    // to the g 0–g 8 slots so switching still works immediately; emails appear on
    // the next palette open once the bridge has populated accountNames.
    let indices;
    if (known.length >= 2) {
      indices = known.map((a) => a.index);
      if (!indices.includes(cur)) indices.push(cur);
      indices = [...new Set(indices)].sort((a, b) => a - b);
    } else {
      indices = [];
      for (let i = 0; i <= 8; i++) indices.push(i);
    }
    const rows = indices.map((index) => {
      const email = names[String(index)];
      return {
        id: `acct-${index}`,
        title: email ? `Switch to ${email}` : `Switch to account u/${index}`,
        hint: index === cur ? "current" : `g ${index}`,
        group: "Accounts",
        keys: [`g ${index}`],
        contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
        run: () => accounts.switchTo(index),
      };
    });
    rows.push({
      id: "accounts-config",
      title: "Configure accounts…",
      group: "Accounts",
      keys: [],
      contexts: InboxKeys_KEYMAP.DEFAULT_CONTEXTS,
      run: () => accounts.openConfig(),
    });
    return rows;
  }

  // Built fresh each time the palette opens so tab/account/override state is current.
  function all() {
    return [...buildBase(), ...tabCommands(), ...settingsCommands(), ...accountCommands(), ...extra];
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
  InboxKeys.commands = {
    all,
    register,
    byKeys,
    get base() {
      return buildBase();
    },
  };
})();
