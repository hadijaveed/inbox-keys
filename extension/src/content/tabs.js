// Split-inbox tabs.
//
// Renders a horizontal tab bar at the top of Gmail's main area. Each tab is a
// saved Gmail search (any operator Gmail supports: label:, is:, from:, has:,
// category:, etc.). "inbox" is the special landing tab. Clicking a tab drives
// Gmail's own hash router (#inbox / #search/<query>), so the list below is
// rendered by Gmail itself — robust across redesigns.
//
// A gear at the end opens an in-Gmail config modal to add/rename/remove tabs,
// with one-click suggestions. Everything persists in chrome.storage and the bar
// re-injects itself as Gmail re-renders (MutationObserver).
window.OpenSuperhuman = window.OpenSuperhuman || {};

(function () {
  const { storage, gmail } = OpenSuperhuman;

  let bar = null;
  let observer = null;

  const GEAR_SVG =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path fill="currentColor" d="M19.14 12.94a7.49 7.49 0 0 0 .05-.94 7.49 7.49 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.34 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.03.31-.05.62-.05.94 0 .32.02.63.05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.42.32.66.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.05.24.25.42.5.42h3.84c.25 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.24.1.52.02.66-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/>' +
    "</svg>";

  // Built-in suggestions offered in the config modal.
  const SUGGESTION_GROUPS = [
    {
      title: "Daily triage",
      items: [
        { name: "Unread", query: "in:inbox is:unread", note: "Unread Inbox mail to clear first" },
        { name: "Important", query: "in:inbox is:important", note: "Priority Inbox mail" },
        { name: "Today", query: "in:inbox newer_than:1d", note: "Fresh Inbox mail only" },
        { name: "To me", query: "in:inbox to:me", note: "Directly addressed Inbox mail" },
      ],
    },
    {
      title: "Follow-up",
      items: [
        { name: "Starred", query: "in:inbox is:starred", note: "Starred Inbox follow-ups" },
        { name: "Sent follow-up", query: "from:me -in:chats older_than:2d", note: "Sent mail to revisit" },
        { name: "Attachments", query: "in:inbox has:attachment", note: "Inbox mail with files" },
      ],
    },
    {
      title: "Gmail categories",
      items: [
        { name: "Updates", query: "in:inbox category:updates", note: "Notifications and tools" },
        { name: "Social", query: "in:inbox category:social", note: "Social networks" },
        { name: "Promotions", query: "in:inbox category:promotions", note: "Marketing mail" },
      ],
    },
  ];

  function tabs() {
    return storage.get("tabs") || [];
  }

  const LEGACY_QUERIES = {
    unread: ["is:unread"],
    important: ["is:important"],
    starred: ["is:starred"],
    attachments: ["has:attachment"],
  };

  const CANONICAL_QUERIES = {
    unread: "in:inbox is:unread",
    important: "in:inbox is:important",
    starred: "in:inbox is:starred",
    attachments: "in:inbox has:attachment",
  };

  const HASH_ALIASES = {
    important: [/^#imp(?:\/|$)/],
    starred: [/^#starred(?:\/|$)/],
  };

  let lastSplitTabId = null;

  function normQuery(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function effectiveQuery(tab) {
    const canonical = CANONICAL_QUERIES[tab && tab.id];
    if (!canonical) return tab.query || "";
    const current = normQuery(tab.query);
    const legacy = (LEGACY_QUERIES[tab.id] || []).map(normQuery);
    return legacy.includes(current) ? canonical : tab.query || "";
  }

  function hashFor(tab) {
    if (tab.type === "inbox") return "#inbox";
    return "#search/" + encodeURIComponent(effectiveQuery(tab));
  }

  function remember(tab) {
    lastSplitTabId = tab && tab.id ? tab.id : null;
  }

  function navigate(tab) {
    remember(tab);
    location.hash = hashFor(tab);
  }

  function searchBoxQuery() {
    const box = Array.from(
      document.querySelectorAll('input[aria-label="Search mail"], input[name="q"]')
    ).filter((el) => gmail.isVisible(el))[0];
    return box ? box.value || "" : "";
  }

  // Current search query from the hash, stripping any trailing thread id.
  function currentQuery() {
    const parts = (location.hash || "").replace(/^#/, "").split("/");
    if (parts[0] !== "search") return searchBoxQuery() || null;
    try {
      return decodeURIComponent(parts[1] || "") || searchBoxQuery() || null;
    } catch {
      return parts[1] || searchBoxQuery() || null;
    }
  }

  function matchesQuery(tab, query) {
    if (!tab || tab.type === "inbox" || query == null) return false;
    const active = normQuery(query);
    if (!active) return false;
    if (active === normQuery(tab.query)) return true;
    if (active === normQuery(effectiveQuery(tab))) return true;
    if (active === normQuery(CANONICAL_QUERIES[tab.id])) return true;
    return (LEGACY_QUERIES[tab.id] || []).some((legacy) => active === normQuery(legacy));
  }

  function activeTabId() {
    const h = location.hash || "#inbox";
    const q = currentQuery();
    if ((h === "" || h === "#" || /^#inbox(\b|\/|$)/.test(h)) && !normQuery(q)) return "inbox";
    for (const tab of tabs()) {
      if ((HASH_ALIASES[tab.id] || []).some((re) => re.test(h))) return tab.id;
      if (matchesQuery(tab, q)) return tab.id;
    }
    // Gmail can repaint the top filter chips/search tools after a split-tab
    // navigation and temporarily leave no reliable hash/search value to match.
    // Preserve the split-tab the extension just navigated to so highlight and
    // Tab/Shift+Tab cycling do not reset to Inbox during that repaint.
    if (/^#search(?:\/|$)/.test(h) && lastSplitTabId) return lastSplitTabId;
    return null;
  }

  function isActive(tab) {
    return !!tab && activeTabId() === tab.id;
  }

  // Cycle the split-inbox tabs relative to the active one, wrapping around.
  // If nothing matches the current view, start from the first tab.
  function cycle(dir) {
    const list = tabs();
    if (!list.length) return;
    const activeId = activeTabId();
    let cur = list.findIndex((t) => t.id === activeId);
    if (cur < 0) cur = 0;
    const next = (cur + dir + list.length) % list.length;
    navigate(list[next]);
  }

  function next() {
    cycle(1);
  }

  function prev() {
    cycle(-1);
  }

  // ---- bar rendering ----------------------------------------------------

  function build() {
    const el = document.createElement("div");
    el.id = "open-superhuman-tab-bar";
    el.className = "open-superhuman-tabbar";
    tabs().forEach((tab) => {
      const b = document.createElement("button");
      b.className = "open-superhuman-tab";
      b.dataset.id = tab.id;
      b.textContent = tab.name;
      b.title = tab.type === "inbox" ? "Inbox" : effectiveQuery(tab);
      b.addEventListener("click", () => navigate(tab));
      el.appendChild(b);
    });
    const gear = document.createElement("button");
    gear.className = "open-superhuman-tab-gear";
    gear.title = "Configure OpenSuperhuman Tabs";
    gear.setAttribute("aria-label", "Configure OpenSuperhuman Tabs");
    gear.innerHTML = GEAR_SVG;
    gear.addEventListener("click", openConfig);
    el.appendChild(gear);
    return el;
  }

  function mainEl() {
    return Array.from(document.querySelectorAll('[role="main"]')).filter((e) => gmail.isVisible(e))[0] || null;
  }

  function updateActive() {
    if (!bar) return;
    const list = tabs();
    bar.querySelectorAll(".open-superhuman-tab").forEach((b, i) => {
      b.classList.toggle("open-superhuman-tab--active", list[i] ? isActive(list[i]) : false);
    });
  }

  // Insert (or re-insert) the bar at the top of Gmail's main area.
  function ensure() {
    if (storage.get("tabsEnabled") === false) {
      if (bar && bar.parentElement) bar.remove();
      return;
    }
    const main = mainEl();
    if (!main) return;
    if (!bar) bar = build();
    if (bar.parentElement !== main) main.insertBefore(bar, main.firstChild);
    updateActive();
  }

  function rebuild() {
    if (bar) bar.remove();
    bar = null;
    ensure();
  }

  // ---- config modal -----------------------------------------------------

  let cfg = null;
  let shortcutRecording = null;

  function keymapCommands() {
    return (window.OpenSuperhuman_KEYMAP && OpenSuperhuman_KEYMAP.commands) || [];
  }

  function shortcutKeysFor(cmd, overrides) {
    if (window.OpenSuperhuman_KEYMAP && typeof OpenSuperhuman_KEYMAP.keysFor === "function") {
      return OpenSuperhuman_KEYMAP.keysFor(cmd.id, overrides || {}) || [];
    }
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, cmd.id)) return overrides[cmd.id] || [];
    return cmd.defaultKeys || [];
  }

  function shortcutChips(binding) {
    const display = window.OpenSuperhuman_KEYMAP && typeof OpenSuperhuman_KEYMAP.displayBinding === "function"
      ? OpenSuperhuman_KEYMAP.displayBinding(binding)
      : String(binding || "");
    return display
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => `<kbd>${escapeAttr(part)}</kbd>`)
      .join("");
  }

  function shortcutToken(e) {
    let k = e.key;
    if (k === " ") k = "Space";
    if (k.length === 1) {
      const mods = [];
      if (e.metaKey) mods.push("Mod");
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey && /[a-zA-Z]/.test(k)) {
        mods.push("Shift");
        k = k.toUpperCase();
      }
      return mods.length ? mods.join("+") + "+" + k : k;
    }
    return k;
  }

  function contextsOverlap(a, b) {
    const left = a && a.length ? a : OpenSuperhuman_KEYMAP.DEFAULT_CONTEXTS;
    const right = b && b.length ? b : OpenSuperhuman_KEYMAP.DEFAULT_CONTEXTS;
    if (left.includes("*") || right.includes("*")) return true;
    return left.some((ctx) => right.includes(ctx));
  }

  function findShortcutCollision(binding, selfId, overrides) {
    return keymapCommands().find((cmd) => {
      if (cmd.id === selfId) return false;
      if (!contextsOverlap(cmd.contexts, (keymapCommands().find((c) => c.id === selfId) || {}).contexts)) return false;
      return shortcutKeysFor(cmd, overrides).includes(binding);
    }) || null;
  }

  function openConfig(initialPane = "tabs") {
    if (cfg) {
      const pane = initialPane === "shortcuts" ? "shortcuts" : "tabs";
      const tab = cfg.querySelector(`[data-settings-tab="${pane}"]`);
      if (tab) tab.click();
      else closeConfig();
      return;
    }
    const working = tabs().map((t) => ({ ...t }));
    let workingKeyOverrides = { ...(storage.get("keyOverrides") || {}) };
    let shortcutFilter = "";
    let activePane = initialPane === "shortcuts" ? "shortcuts" : "tabs";

    cfg = document.createElement("div");
    cfg.className = "open-superhuman-overlay open-superhuman-overlay--open open-superhuman-cfg-overlay";
    cfg.innerHTML = `
      <div class="open-superhuman-modal open-superhuman-cfg" role="dialog" aria-label="Configure tabs">
        <div class="open-superhuman-cfg-head">
          <div>
            <div class="open-superhuman-cfg-title">Open Superhuman settings</div>
            <div class="open-superhuman-cfg-sub">Tune your split inbox and keyboard shortcuts without leaving Gmail. Search shortcuts by action, group, or key.</div>
          </div>
          <button class="open-superhuman-cfg-x" aria-label="Close">esc</button>
        </div>
        <div class="open-superhuman-cfg-tabs" role="tablist" aria-label="Open Superhuman settings sections">
          <button class="open-superhuman-cfg-tab" type="button" role="tab" data-settings-tab="tabs">Tabs</button>
          <button class="open-superhuman-cfg-tab" type="button" role="tab" data-settings-tab="shortcuts">Keyboard shortcuts</button>
        </div>
        <div class="open-superhuman-cfg-body">
          <section class="open-superhuman-cfg-panel open-superhuman-cfg-panel--tabs" data-settings-panel="tabs">
            <div class="open-superhuman-cfg-section-head">
              <div>
                <div class="open-superhuman-cfg-section-title">Split inbox tabs</div>
                <div class="open-superhuman-cfg-section-sub">Keep 4-6 tabs for daily triage. Use Gmail operators like <code>label:</code>, <code>is:</code>, <code>from:</code>, <code>has:</code>, <code>category:</code>.</div>
              </div>
            </div>
            <div class="open-superhuman-cfg-list"></div>
            <div class="open-superhuman-cfg-actions">
              <button class="open-superhuman-cfg-add">+ Add tab</button>
              <button class="open-superhuman-cfg-reset">Reset defaults</button>
            </div>
            <div class="open-superhuman-cfg-suggest-label">Presets</div>
            <div class="open-superhuman-cfg-suggest"></div>
          </section>
          <section class="open-superhuman-cfg-panel open-superhuman-cfg-panel--keys" data-settings-panel="shortcuts">
            <div class="open-superhuman-cfg-section-head open-superhuman-shortcuts-head">
              <div>
                <div class="open-superhuman-cfg-section-title">Keyboard shortcuts</div>
                <div class="open-superhuman-cfg-section-sub">Click an editable shortcut, then press the new key or combo. Shift, Ctrl, Alt, and Cmd combos are supported. Built-in shortcuts are read-only.</div>
              </div>
              <button class="open-superhuman-shortcut-reset-all">Reset shortcuts</button>
            </div>
            <div class="open-superhuman-shortcut-tools">
              <div class="open-superhuman-shortcut-search-wrap">
                <span class="open-superhuman-shortcut-search-icon" aria-hidden="true">⌕</span>
                <input class="open-superhuman-shortcut-search" type="search" placeholder="Search shortcuts, actions, or keys..." autocomplete="off" />
              </div>
              <div class="open-superhuman-shortcut-count"></div>
            </div>
            <div class="open-superhuman-shortcut-list"></div>
          </section>
        </div>
        <div class="open-superhuman-cfg-foot">
          <span class="open-superhuman-cfg-hint"></span>
          <span>
            <button class="open-superhuman-btn open-superhuman-btn--ghost open-superhuman-cfg-cancel">Cancel</button>
            <button class="open-superhuman-btn open-superhuman-cfg-save">Save</button>
          </span>
        </div>
      </div>`;
    document.documentElement.appendChild(cfg);

    const list = cfg.querySelector(".open-superhuman-cfg-list");
    const suggestWrap = cfg.querySelector(".open-superhuman-cfg-suggest");
    const shortcutList = cfg.querySelector(".open-superhuman-shortcut-list");
    const shortcutSearch = cfg.querySelector(".open-superhuman-shortcut-search");
    const shortcutCount = cfg.querySelector(".open-superhuman-shortcut-count");
    const hint = cfg.querySelector(".open-superhuman-cfg-hint");

    function setSettingsPane(pane) {
      activePane = pane === "shortcuts" ? "shortcuts" : "tabs";
      cfg.querySelectorAll("[data-settings-tab]").forEach((tab) => {
        const selected = tab.dataset.settingsTab === activePane;
        tab.classList.toggle("open-superhuman-cfg-tab--active", selected);
        tab.setAttribute("aria-selected", selected ? "true" : "false");
        tab.tabIndex = selected ? 0 : -1;
      });
      cfg.querySelectorAll("[data-settings-panel]").forEach((panel) => {
        const selected = panel.dataset.settingsPanel === activePane;
        panel.classList.toggle("open-superhuman-cfg-panel--active", selected);
        panel.hidden = !selected;
      });
      hint.innerHTML =
        activePane === "shortcuts"
          ? "Tip: shortcut changes save with this modal. Press <code>Esc</code> while recording to cancel."
          : "Tip: tab changes save with this modal. Use <code>in:inbox</code> for tabs you want to clear with Archive.";
    }

    function rowFor(tab, i) {
      const row = document.createElement("div");
      row.className = "open-superhuman-cfg-row";
      const isInbox = tab.type === "inbox";
      row.innerHTML = `
        <input class="open-superhuman-cfg-name" value="${escapeAttr(tab.name)}" placeholder="Tab name" />
        <input class="open-superhuman-cfg-query" value="${escapeAttr(tab.query || "")}" placeholder="${isInbox ? "Inbox (the default view)" : "in:inbox is:unread, label:Clients, from:boss@…"}" ${isInbox ? "disabled" : ""} />
        <button class="open-superhuman-cfg-del" title="Remove" ${isInbox ? "disabled" : ""}>✕</button>`;
      row.querySelector(".open-superhuman-cfg-name").addEventListener("input", (e) => (working[i].name = e.target.value));
      if (!isInbox) {
        row.querySelector(".open-superhuman-cfg-query").addEventListener("input", (e) => (working[i].query = e.target.value));
        row.querySelector(".open-superhuman-cfg-del").addEventListener("click", () => {
          working.splice(i, 1);
          renderRows();
        });
      }
      return row;
    }

    function renderRows() {
      list.innerHTML = "";
      working.forEach((tab, i) => list.appendChild(rowFor(tab, i)));
      renderSuggestions();
    }

    function effectiveShortcutKeys(cmd) {
      return shortcutKeysFor(cmd, workingKeyOverrides);
    }

    function renderShortcuts() {
      const filter = shortcutFilter.trim().toLowerCase();
      const groups = [];
      const byGroup = new Map();
      let shown = 0;
      keymapCommands().forEach((cmd) => {
        const keys = effectiveShortcutKeys(cmd);
        const displayKeys = window.OpenSuperhuman_KEYMAP && typeof OpenSuperhuman_KEYMAP.displayBinding === "function"
          ? keys.map((key) => OpenSuperhuman_KEYMAP.displayBinding(key))
          : keys;
        const hay = `${cmd.title} ${cmd.group || ""} ${keys.join(" ")} ${displayKeys.join(" ")} ${(cmd.contexts || []).join(" ")}`.toLowerCase();
        if (filter && !hay.includes(filter)) return;
        const group = cmd.group || "Other";
        if (!byGroup.has(group)) {
          byGroup.set(group, []);
          groups.push(group);
        }
        byGroup.get(group).push(cmd);
      });
      shortcutList.innerHTML = "";
      groups.forEach((group) => {
        const head = document.createElement("div");
        head.className = "open-superhuman-shortcut-group";
        head.textContent = group;
        shortcutList.appendChild(head);
        byGroup.get(group).forEach((cmd) => {
          shown++;
          shortcutList.appendChild(shortcutRow(cmd));
        });
      });
      if (!shown) {
        const empty = document.createElement("div");
        empty.className = "open-superhuman-shortcut-empty";
        empty.textContent = "No shortcuts match your search.";
        shortcutList.appendChild(empty);
      }
      shortcutCount.textContent = shown ? `${shown} shown` : "0 shown";
    }

    function shortcutRow(cmd) {
      const row = document.createElement("div");
      row.className = "open-superhuman-shortcut-row" + (cmd.fixed ? " open-superhuman-shortcut-row--fixed" : "");
      row.dataset.id = cmd.id;

      const meta = document.createElement("div");
      meta.className = "open-superhuman-shortcut-meta";
      const title = document.createElement("div");
      title.className = "open-superhuman-shortcut-title";
      title.textContent = cmd.title;
      const context = document.createElement("div");
      context.className = "open-superhuman-shortcut-context";
      context.textContent = (cmd.contexts || []).join(", ") || "all contexts";
      meta.appendChild(title);
      meta.appendChild(context);
      row.appendChild(meta);

      const keys = document.createElement("button");
      keys.type = "button";
      keys.className = "open-superhuman-shortcut-keys";
      keys.disabled = !!cmd.fixed;
      const effective = effectiveShortcutKeys(cmd);
      keys.innerHTML = effective.length
        ? effective.map(shortcutChips).join('<span class="open-superhuman-shortcut-or">or</span>')
        : '<span class="open-superhuman-shortcut-none">not set</span>';
      if (!cmd.fixed) {
        keys.title = "Record a new shortcut";
        keys.addEventListener("click", () => startShortcutRecording(cmd, row, keys));
      } else {
        keys.title = "Built-in shortcut";
      }
      row.appendChild(keys);

      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "open-superhuman-shortcut-reset";
      reset.textContent = "Reset";
      reset.disabled = cmd.fixed || !Array.isArray(workingKeyOverrides[cmd.id]);
      reset.addEventListener("click", () => {
        delete workingKeyOverrides[cmd.id];
        renderShortcuts();
      });
      row.appendChild(reset);

      return row;
    }

    function startShortcutRecording(cmd, row, keys) {
      cancelShortcutRecording(false);
      shortcutRecording = { cmd, row, keys, parts: [], chordTimer: null, cancel: cancelShortcutRecording };
      row.classList.add("open-superhuman-shortcut-row--recording");
      keys.innerHTML = '<span class="open-superhuman-shortcut-listening">Press key or combo...</span>';
      document.addEventListener("keydown", onShortcutRecordKey, true);
    }

    function renderShortcutRecording() {
      if (!shortcutRecording) return;
      const chips = shortcutRecording.parts.map(shortcutChips).join("");
      shortcutRecording.keys.innerHTML = chips || '<span class="open-superhuman-shortcut-listening">Press key or combo...</span>';
    }

    function cancelShortcutRecording(rerender = true) {
      if (!shortcutRecording) return;
      document.removeEventListener("keydown", onShortcutRecordKey, true);
      if (shortcutRecording.chordTimer) clearTimeout(shortcutRecording.chordTimer);
      shortcutRecording = null;
      if (rerender) renderShortcuts();
    }

    function onShortcutRecordKey(e) {
      if (!shortcutRecording) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        cancelShortcutRecording();
        return;
      }
      if (e.key === "Enter") {
        commitShortcutRecording();
        return;
      }
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      const token = shortcutToken(e);
      if (!token) return;
      if (shortcutRecording.parts.length === 0 && token === "g") {
        shortcutRecording.parts.push("g");
        renderShortcutRecording();
        shortcutRecording.chordTimer = setTimeout(() => {
          shortcutRecording.chordTimer = null;
          commitShortcutRecording();
        }, 800);
        return;
      }
      if (shortcutRecording.parts[0] === "g" && shortcutRecording.chordTimer) {
        clearTimeout(shortcutRecording.chordTimer);
        shortcutRecording.chordTimer = null;
        shortcutRecording.parts.push(token);
      } else {
        shortcutRecording.parts = [token];
      }
      renderShortcutRecording();
      commitShortcutRecording();
    }

    function commitShortcutRecording() {
      if (!shortcutRecording || !shortcutRecording.parts.length) return;
      const id = shortcutRecording.cmd.id;
      const binding = shortcutRecording.parts.join(" ");
      if (shortcutRecording.chordTimer) {
        clearTimeout(shortcutRecording.chordTimer);
        shortcutRecording.chordTimer = null;
      }
      const collision = findShortcutCollision(binding, id, workingKeyOverrides);
      if (collision) {
        if (collision.fixed) {
          OpenSuperhuman.toast(`Shortcut reserved for ${collision.title}`, "warn");
          cancelShortcutRecording();
          return;
        }
        workingKeyOverrides = {
          ...workingKeyOverrides,
          [collision.id]: effectiveShortcutKeys(collision).filter((key) => key !== binding),
        };
      }
      workingKeyOverrides = { ...workingKeyOverrides, [id]: [binding] };
      cancelShortcutRecording();
    }

    function addTab(name, query) {
      const existing = working.findIndex((tab) => tab.type === "search" && norm(tab.query) === norm(query));
      if (existing >= 0) {
        focusRow(existing);
        OpenSuperhuman.toast("Tab already added");
        return;
      }
      working.push({ id: "t" + Date.now() + Math.floor(Math.random() * 1000), name: name || "New tab", type: "search", query: query || "" });
      renderRows();
    }

    function renderSuggestions() {
      suggestWrap.innerHTML = "";
      SUGGESTION_GROUPS.forEach((group) => {
        const box = document.createElement("div");
        box.className = "open-superhuman-cfg-suggest-group";
        const title = document.createElement("div");
        title.className = "open-superhuman-cfg-suggest-title";
        title.textContent = group.title;
        box.appendChild(title);
        const chips = document.createElement("div");
        chips.className = "open-superhuman-cfg-suggest-chips";
        group.items.forEach((s) => {
          const chip = document.createElement("button");
          const exists = working.some((tab) => tab.type === "search" && norm(tab.query) === norm(s.query));
          chip.className = "open-superhuman-cfg-chip" + (exists ? " open-superhuman-cfg-chip--added" : "");
          chip.title = s.query;
          chip.disabled = exists;
          const main = document.createElement("span");
          main.className = "open-superhuman-cfg-chip-main";
          main.textContent = s.name;
          const note = document.createElement("span");
          note.className = "open-superhuman-cfg-chip-note";
          note.textContent = exists ? "Added" : s.note;
          chip.appendChild(main);
          chip.appendChild(note);
          chip.addEventListener("click", () => addTab(s.name, s.query));
          chips.appendChild(chip);
        });
        box.appendChild(chips);
        suggestWrap.appendChild(box);
      });
    }

    function focusRow(i) {
      const rows = Array.from(list.querySelectorAll(".open-superhuman-cfg-row"));
      const row = rows[i];
      if (!row) return;
      row.classList.add("open-superhuman-cfg-row--pulse");
      const input = row.querySelector(".open-superhuman-cfg-name");
      if (input) input.focus();
      setTimeout(() => row.classList.remove("open-superhuman-cfg-row--pulse"), 700);
    }

    function norm(value) {
      return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    }

    renderRows();
    renderShortcuts();
    setSettingsPane(activePane);

    cfg.querySelectorAll("[data-settings-tab]").forEach((tab) => {
      tab.addEventListener("click", () => setSettingsPane(tab.dataset.settingsTab));
    });
    cfg.querySelector(".open-superhuman-cfg-add").addEventListener("click", () => addTab("", ""));
    cfg.querySelector(".open-superhuman-cfg-reset").addEventListener("click", () => {
      working.splice(0, working.length, ...OpenSuperhuman.DEFAULTS.tabs.map((t) => ({ ...t })));
      renderRows();
    });
    cfg.querySelector(".open-superhuman-shortcut-search").addEventListener("input", (e) => {
      shortcutFilter = e.target.value || "";
      renderShortcuts();
    });
    cfg.querySelector(".open-superhuman-shortcut-reset-all").addEventListener("click", () => {
      workingKeyOverrides = {};
      cancelShortcutRecording(false);
      renderShortcuts();
    });
    cfg.querySelector(".open-superhuman-cfg-cancel").addEventListener("click", closeConfig);
    cfg.querySelector(".open-superhuman-cfg-x").addEventListener("click", closeConfig);
    cfg.querySelector(".open-superhuman-cfg-save").addEventListener("click", async () => {
      const cleaned = working
        .map((t) => ({ ...t, name: (t.name || "").trim() }))
        .filter((t) => t.type === "inbox" || (t.name && (t.query || "").trim()));
      await storage.set({ tabs: cleaned, keyOverrides: workingKeyOverrides });
      closeConfig();
      rebuild();
      OpenSuperhuman.toast("Settings saved");
    });
    cfg.addEventListener("mousedown", (e) => {
      if (e.target === cfg) closeConfig();
    });
    document.addEventListener("keydown", onCfgKey, true);
  }

  function onCfgKey(e) {
    if (shortcutRecording) return;
    if (e.key === "Escape" && cfg) {
      e.preventDefault();
      e.stopPropagation();
      closeConfig();
    }
  }

  function closeConfig() {
    if (shortcutRecording && typeof shortcutRecording.cancel === "function") shortcutRecording.cancel(false);
    document.removeEventListener("keydown", onCfgKey, true);
    if (cfg) cfg.remove();
    cfg = null;
  }

  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- lifecycle --------------------------------------------------------

  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function init() {
    ensure();
    observer = new MutationObserver(debounce(ensure, 200));
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", ensure);
    const isJsdom = /jsdom/i.test((navigator && navigator.userAgent) || "");
    if (!isJsdom) {
      let lastRoute = "";
      setInterval(() => {
        const route = location.href + "|" + searchBoxQuery();
        if (route === lastRoute) return;
        lastRoute = route;
        ensure();
      }, 500);
    }
    storage.onChange((_, changes) => {
      if (changes && (changes.tabs || changes.tabsEnabled)) rebuild();
    });
  }

  OpenSuperhuman.tabs = { init, openConfig, navigate, list: tabs, next, prev };
})();
