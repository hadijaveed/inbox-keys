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
window.CMDK = window.CMDK || {};

(function () {
  const { storage, gmail } = CMDK;

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
        { name: "Unread", query: "is:unread", note: "New things to clear first" },
        { name: "Important", query: "is:important", note: "Gmail priority signals" },
        { name: "Today", query: "newer_than:1d", note: "Fresh mail only" },
        { name: "To me", query: "to:me", note: "Directly addressed" },
      ],
    },
    {
      title: "Follow-up",
      items: [
        { name: "Starred", query: "is:starred", note: "Hand-picked follow-ups" },
        { name: "Sent follow-up", query: "from:me -in:chats older_than:2d", note: "Sent mail to revisit" },
        { name: "Attachments", query: "has:attachment", note: "Files and docs" },
      ],
    },
    {
      title: "Gmail categories",
      items: [
        { name: "Updates", query: "category:updates", note: "Notifications and tools" },
        { name: "Social", query: "category:social", note: "Social networks" },
        { name: "Promotions", query: "category:promotions", note: "Marketing mail" },
      ],
    },
  ];

  function tabs() {
    return storage.get("tabs") || [];
  }

  function hashFor(tab) {
    if (tab.type === "inbox") return "#inbox";
    return "#search/" + encodeURIComponent(tab.query || "");
  }

  function navigate(tab) {
    location.hash = hashFor(tab);
  }

  // Current search query from the hash, stripping any trailing thread id.
  function currentQuery() {
    const parts = (location.hash || "").replace(/^#/, "").split("/");
    if (parts[0] !== "search") return null;
    try {
      return decodeURIComponent(parts[1] || "");
    } catch {
      return parts[1] || "";
    }
  }

  function isActive(tab) {
    const h = location.hash || "#inbox";
    if (tab.type === "inbox") return /^#inbox(\b|\/|$)/.test(h) || h === "" || h === "#";
    const q = currentQuery();
    return q != null && q === (tab.query || "");
  }

  // Cycle the split-inbox tabs relative to the active one, wrapping around.
  // If nothing matches the current view, start from the first tab.
  function cycle(dir) {
    const list = tabs();
    if (!list.length) return;
    let cur = list.findIndex((t) => isActive(t));
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
    el.id = "cmdk-tab-bar";
    el.className = "cmdk-tabbar";
    tabs().forEach((tab) => {
      const b = document.createElement("button");
      b.className = "cmdk-tab";
      b.dataset.id = tab.id;
      b.textContent = tab.name;
      b.title = tab.type === "inbox" ? "Inbox" : tab.query;
      b.addEventListener("click", () => navigate(tab));
      el.appendChild(b);
    });
    const gear = document.createElement("button");
    gear.className = "cmdk-tab-gear";
    gear.title = "Configure CMDK Tabs";
    gear.setAttribute("aria-label", "Configure CMDK Tabs");
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
    bar.querySelectorAll(".cmdk-tab").forEach((b, i) => {
      b.classList.toggle("cmdk-tab--active", list[i] ? isActive(list[i]) : false);
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

  function openConfig() {
    if (cfg) {
      closeConfig();
      return;
    }
    const working = tabs().map((t) => ({ ...t }));

    cfg = document.createElement("div");
    cfg.className = "cmdk-overlay cmdk-overlay--open cmdk-cfg-overlay";
    cfg.innerHTML = `
      <div class="cmdk-modal cmdk-cfg" role="dialog" aria-label="Configure tabs">
        <div class="cmdk-cfg-head">
          <div>
            <div class="cmdk-cfg-title">Split inbox tabs</div>
            <div class="cmdk-cfg-sub">Build a focused Gmail workspace. Keep 4-6 tabs for daily triage, then use search operators like <code>label:</code>, <code>is:</code>, <code>from:</code>, <code>has:</code>, <code>category:</code>.</div>
          </div>
          <button class="cmdk-cfg-x" aria-label="Close">esc</button>
        </div>
        <div class="cmdk-cfg-list"></div>
        <div class="cmdk-cfg-actions">
          <button class="cmdk-cfg-add">+ Add tab</button>
          <button class="cmdk-cfg-reset">Reset defaults</button>
        </div>
        <div class="cmdk-cfg-suggest-label">Presets</div>
        <div class="cmdk-cfg-suggest"></div>
        <div class="cmdk-cfg-foot">
          <span class="cmdk-cfg-hint">Good defaults: Inbox, Unread, Important, Starred, Attachments.</span>
          <span>
            <button class="cmdk-btn cmdk-btn--ghost cmdk-cfg-cancel">Cancel</button>
            <button class="cmdk-btn cmdk-cfg-save">Save</button>
          </span>
        </div>
      </div>`;
    document.documentElement.appendChild(cfg);

    const list = cfg.querySelector(".cmdk-cfg-list");
    const suggestWrap = cfg.querySelector(".cmdk-cfg-suggest");

    function rowFor(tab, i) {
      const row = document.createElement("div");
      row.className = "cmdk-cfg-row";
      const isInbox = tab.type === "inbox";
      row.innerHTML = `
        <input class="cmdk-cfg-name" value="${escapeAttr(tab.name)}" placeholder="Tab name" />
        <input class="cmdk-cfg-query" value="${escapeAttr(tab.query || "")}" placeholder="${isInbox ? "Inbox (the default view)" : "is:unread, label:Clients, from:boss@…"}" ${isInbox ? "disabled" : ""} />
        <button class="cmdk-cfg-del" title="Remove" ${isInbox ? "disabled" : ""}>✕</button>`;
      row.querySelector(".cmdk-cfg-name").addEventListener("input", (e) => (working[i].name = e.target.value));
      if (!isInbox) {
        row.querySelector(".cmdk-cfg-query").addEventListener("input", (e) => (working[i].query = e.target.value));
        row.querySelector(".cmdk-cfg-del").addEventListener("click", () => {
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

    function addTab(name, query) {
      const existing = working.findIndex((tab) => tab.type === "search" && norm(tab.query) === norm(query));
      if (existing >= 0) {
        focusRow(existing);
        CMDK.toast("Tab already added");
        return;
      }
      working.push({ id: "t" + Date.now() + Math.floor(Math.random() * 1000), name: name || "New tab", type: "search", query: query || "" });
      renderRows();
    }

    function renderSuggestions() {
      suggestWrap.innerHTML = "";
      SUGGESTION_GROUPS.forEach((group) => {
        const box = document.createElement("div");
        box.className = "cmdk-cfg-suggest-group";
        const title = document.createElement("div");
        title.className = "cmdk-cfg-suggest-title";
        title.textContent = group.title;
        box.appendChild(title);
        const chips = document.createElement("div");
        chips.className = "cmdk-cfg-suggest-chips";
        group.items.forEach((s) => {
          const chip = document.createElement("button");
          const exists = working.some((tab) => tab.type === "search" && norm(tab.query) === norm(s.query));
          chip.className = "cmdk-cfg-chip" + (exists ? " cmdk-cfg-chip--added" : "");
          chip.title = s.query;
          chip.disabled = exists;
          const main = document.createElement("span");
          main.className = "cmdk-cfg-chip-main";
          main.textContent = s.name;
          const note = document.createElement("span");
          note.className = "cmdk-cfg-chip-note";
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
      const rows = Array.from(list.querySelectorAll(".cmdk-cfg-row"));
      const row = rows[i];
      if (!row) return;
      row.classList.add("cmdk-cfg-row--pulse");
      const input = row.querySelector(".cmdk-cfg-name");
      if (input) input.focus();
      setTimeout(() => row.classList.remove("cmdk-cfg-row--pulse"), 700);
    }

    function norm(value) {
      return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    }

    renderRows();

    cfg.querySelector(".cmdk-cfg-add").addEventListener("click", () => addTab("", ""));
    cfg.querySelector(".cmdk-cfg-reset").addEventListener("click", () => {
      working.splice(0, working.length, ...CMDK.DEFAULTS.tabs.map((t) => ({ ...t })));
      renderRows();
    });
    cfg.querySelector(".cmdk-cfg-cancel").addEventListener("click", closeConfig);
    cfg.querySelector(".cmdk-cfg-x").addEventListener("click", closeConfig);
    cfg.querySelector(".cmdk-cfg-save").addEventListener("click", async () => {
      const cleaned = working
        .map((t) => ({ ...t, name: (t.name || "").trim() }))
        .filter((t) => t.type === "inbox" || (t.name && (t.query || "").trim()));
      await storage.set({ tabs: cleaned });
      closeConfig();
      rebuild();
      CMDK.toast("Tabs saved");
    });
    cfg.addEventListener("mousedown", (e) => {
      if (e.target === cfg) closeConfig();
    });
    document.addEventListener("keydown", onCfgKey, true);
  }

  function onCfgKey(e) {
    if (e.key === "Escape" && cfg) {
      e.preventDefault();
      e.stopPropagation();
      closeConfig();
    }
  }

  function closeConfig() {
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
    storage.onChange((_, changes) => {
      if (changes && (changes.tabs || changes.tabsEnabled)) rebuild();
    });
  }

  CMDK.tabs = { init, openConfig, navigate, list: tabs, next, prev };
})();
