// Shared keybinding catalog: the single source of truth for default keys, the
// contexts each command fires in, and which bindings are "fixed" (engine
// special-cases them; settings UI shows them read-only).
// Plain data only — no chrome APIs, no window.OpenSuperhuman dependency. Loaded as the
// FIRST content script AND by options.html via <script src="../shared/keymap.js">.
(function () {
  const DEFAULT_CONTEXTS = ["inboxList", "threadView", "unknown"];

  // contexts: where the binding is live. fixed: engine handles it specially and
  // the settings UI renders it read-only.
  const commands = [
    // Compose / messaging
    { id: "compose", title: "Compose new email", group: "Compose", defaultKeys: ["c"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "reply", title: "Reply", group: "Compose", defaultKeys: ["r"], contexts: ["threadView"], fixed: false },
    { id: "reply-all", title: "Reply all", group: "Compose", defaultKeys: ["Enter", "a"], contexts: ["threadView"], fixed: false },
    { id: "forward", title: "Forward", group: "Compose", defaultKeys: ["f"], contexts: ["threadView"], fixed: false },
    { id: "open-link-or-attachment", title: "Open link or attachment", group: "Compose", defaultKeys: ["Mod+O"], contexts: ["threadView"], fixed: true },
    { id: "attach-file", title: "Attach file", group: "Compose", defaultKeys: ["Mod+U"], contexts: ["compose"], fixed: true },

    // Triage
    { id: "archive", title: "Archive", group: "Triage", defaultKeys: ["e"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "mark-not-done", title: "Mark not done", group: "Triage", defaultKeys: ["Shift+E"], contexts: ["inboxList", "threadView"], fixed: true },
    { id: "delete", title: "Delete", group: "Triage", defaultKeys: ["#"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "undo", title: "Undo", group: "Triage", defaultKeys: ["z"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "mark-read-unread", title: "Mark read or unread", group: "Triage", defaultKeys: ["u"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "mark-read", title: "Mark as read", group: "Triage", defaultKeys: [], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "mark-unread", title: "Mark as unread", group: "Triage", defaultKeys: [], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "snooze", title: "Snooze", group: "Triage", defaultKeys: ["h", "b"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "report-spam", title: "Report spam", group: "Triage", defaultKeys: ["!"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "star", title: "Star / toggle star", group: "Triage", defaultKeys: ["s"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "mute", title: "Mute", group: "Triage", defaultKeys: ["Shift+M"], contexts: ["inboxList", "threadView"], fixed: true },
    { id: "unsubscribe", title: "Unsubscribe", group: "Triage", defaultKeys: ["Mod+U"], contexts: ["threadView"], fixed: true },
    { id: "label", title: "Add or remove label", group: "Labels", defaultKeys: ["l"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "remove-label", title: "Remove label", group: "Labels", defaultKeys: ["y"], contexts: ["inboxList", "threadView"], fixed: false },
    { id: "remove-all-labels", title: "Remove all labels", group: "Labels", defaultKeys: ["Shift+Y"], contexts: ["inboxList", "threadView"], fixed: true },
    { id: "move", title: "Move", group: "Labels", defaultKeys: ["v"], contexts: ["inboxList", "threadView"], fixed: false },

    // Navigation (chords mirror Gmail's "g" prefix)
    { id: "go-inbox", title: "Go to Inbox", group: "Go to", defaultKeys: ["g i"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-sent", title: "Go to Sent", group: "Go to", defaultKeys: ["g t"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-drafts", title: "Go to Drafts", group: "Go to", defaultKeys: ["g d"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-starred", title: "Go to Starred", group: "Go to", defaultKeys: ["g s"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-snoozed", title: "Go to Snoozed", group: "Go to", defaultKeys: ["g h"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-important", title: "Go to Important", group: "Go to", defaultKeys: [], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-all", title: "Go to All Mail", group: "Go to", defaultKeys: ["g a"], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-spam", title: "Go to Spam", group: "Go to", defaultKeys: [], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-trash", title: "Go to Trash", group: "Go to", defaultKeys: [], contexts: DEFAULT_CONTEXTS, fixed: false },
    { id: "go-settings", title: "Open Settings", group: "Go to", defaultKeys: [], contexts: DEFAULT_CONTEXTS, fixed: false },

    // List scrolling
    { id: "go-top", title: "Go to top of list", group: "Navigation", defaultKeys: ["g g"], contexts: ["inboxList"], fixed: false },
    { id: "go-bottom", title: "Go to bottom of list", group: "Navigation", defaultKeys: ["Shift+G"], contexts: ["inboxList"], fixed: true },
    { id: "expand-message", title: "Expand / collapse focused message", group: "Navigation", defaultKeys: ["o"], contexts: ["threadView"], fixed: false },
    { id: "expand-all", title: "Expand / collapse all messages", group: "Navigation", defaultKeys: ["Shift+O"], contexts: ["threadView"], fixed: true },

    // Split-inbox tabs (engine special-cases Tab / Shift+Tab)
    { id: "next-tab", title: "Next tab", group: "Tabs", defaultKeys: ["Tab"], contexts: ["inboxList"], fixed: true },
    { id: "prev-tab", title: "Previous tab", group: "Tabs", defaultKeys: ["Shift+Tab"], contexts: ["inboxList"], fixed: true },

    // Thread navigation (engine special-cases Escape)
    { id: "back-to-list", title: "Back to list", group: "Navigation", defaultKeys: ["Escape"], contexts: ["threadView"], fixed: true },

    // Calendar (engine special-cases the 0 / 0 0 keys)
    { id: "calendar-half", title: "Open calendar (side panel)", group: "Calendar", defaultKeys: ["0"], contexts: ["inboxList", "unknown"], fixed: true },
    { id: "calendar-tab", title: "Open calendar (new tab)", group: "Calendar", defaultKeys: ["0 0"], contexts: ["inboxList", "unknown"], fixed: true },

    // Search
    { id: "search", title: "Search mail…", group: "Search", defaultKeys: ["/"], contexts: ["inboxList", "threadView"], fixed: false },
  ];

  function keysFor(id, overrides) {
    const ov = overrides || {};
    if (Object.prototype.hasOwnProperty.call(ov, id)) return ov[id] || [];
    const entry = commands.find((c) => c.id === id);
    return entry ? entry.defaultKeys.slice() : [];
  }

  window.OpenSuperhuman_KEYMAP = { DEFAULT_CONTEXTS, commands, keysFor };
})();
