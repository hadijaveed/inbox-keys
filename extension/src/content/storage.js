// Namespaced globals shared across the content scripts.
window.OpenSuperhuman = window.OpenSuperhuman || {};

(function () {
  const DEFAULTS = {
    enabled: true,
    paletteHotkey: "mod+k", // Cmd+K on mac, Ctrl+K elsewhere
    hotkeysEnabled: true,
    accountNames: {}, // { "0": "work@x.com", "1": "me@gmail.com" }
    tabsEnabled: true, // split-inbox tab bar at the top of Gmail
    calendarEnabled: true, // the 0 / 00 calendar shortcut
    keyOverrides: {}, // { commandId: ["e"] } — per-command key remaps
    // Split-inbox tabs. Each tab is a saved Gmail search; "inbox" is the special
    // landing tab. The user edits these from the gear in the tab bar.
    tabs: [
      { id: "inbox", name: "Inbox", type: "inbox", query: "" },
      { id: "unread", name: "Unread", type: "search", query: "in:inbox is:unread" },
      { id: "important", name: "Important", type: "search", query: "in:inbox is:important" },
      { id: "starred", name: "Starred", type: "search", query: "in:inbox is:starred" },
      { id: "attachments", name: "Attachments", type: "search", query: "in:inbox has:attachment" },
    ],
  };

  const TAB_QUERY_MIGRATIONS = {
    unread: { from: "is:unread", to: "in:inbox is:unread" },
    important: { from: "is:important", to: "in:inbox is:important" },
    starred: { from: "is:starred", to: "in:inbox is:starred" },
    attachments: { from: "has:attachment", to: "in:inbox has:attachment" },
  };

  function normalizeTabs(value) {
    if (!Array.isArray(value)) return value;
    let changed = false;
    const tabs = value.map((tab) => {
      const migration = tab && TAB_QUERY_MIGRATIONS[tab.id];
      if (!migration || tab.type !== "search" || tab.query !== migration.from) return tab;
      changed = true;
      return { ...tab, query: migration.to };
    });
    return changed ? tabs : value;
  }

  const storage = {
    cache: { ...DEFAULTS },

    async load() {
      const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
      const tabs = normalizeTabs(stored.tabs);
      this.cache = { ...DEFAULTS, ...stored, ...(tabs ? { tabs } : {}) };
      if (tabs && tabs !== stored.tabs) await chrome.storage.local.set({ tabs });
      return this.cache;
    },

    get(key) {
      return this.cache[key];
    },

    async set(patch) {
      this.cache = { ...this.cache, ...patch };
      await chrome.storage.local.set(patch);
      return this.cache;
    },

    onChange(cb) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        for (const [k, v] of Object.entries(changes)) {
          this.cache[k] = v.newValue;
        }
        cb(this.cache, changes);
      });
    },
  };

  OpenSuperhuman.storage = storage;
  OpenSuperhuman.DEFAULTS = DEFAULTS;
})();
