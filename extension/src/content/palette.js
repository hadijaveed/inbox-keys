// The Cmd+K command palette: an injected overlay with fuzzy search over the
// command registry.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const { commands, storage } = InboxKeys;

  let root, input, list, results, open = false;
  let items = [];
  let active = 0;
  let kbNavAt = 0; // timestamp of the last keyboard move, to ignore stray mouseenter
  let chooseItems = null; // non-null → one-shot picker mode over these items instead of the command registry

  // --- tiny fuzzy matcher: subsequence match with a contiguity bonus ---
  function score(query, text) {
    if (!query) return 1;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let qi = 0, s = 0, streak = 0, lastIdx = -1;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        streak = ti === lastIdx + 1 ? streak + 1 : 1;
        s += streak + (ti === 0 || t[ti - 1] === " " ? 2 : 0); // word-start bonus
        lastIdx = ti;
        qi++;
      }
    }
    return qi === q.length ? s : 0;
  }

  function title(cmd) {
    return typeof cmd.title === "function" ? cmd.title() : cmd.title;
  }

  function keyLabel(binding) {
    if (window.InboxKeys_KEYMAP && typeof InboxKeys_KEYMAP.displayBinding === "function") {
      return InboxKeys_KEYMAP.displayBinding(binding);
    }
    return String(binding || "");
  }

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "inboxkeys-overlay";
    root.innerHTML = `
      <div class="inboxkeys-modal" role="dialog" aria-label="Command palette">
        <div class="inboxkeys-input-row">
          <span class="inboxkeys-prompt"></span>
          <input class="inboxkeys-input" placeholder="Type a command or search…" autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" />
        </div>
        <div class="inboxkeys-results"></div>
        <div class="inboxkeys-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>`;
    document.documentElement.appendChild(root);
    root.querySelector(".inboxkeys-prompt").textContent = keyLabel("Mod+K");
    input = root.querySelector(".inboxkeys-input");
    results = root.querySelector(".inboxkeys-results");

    root.addEventListener("mousedown", (e) => {
      if (e.target === root) hide();
    });
    input.addEventListener("input", () => render());
    input.addEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      hide();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(active);
    } else if (e.key === "Tab") {
      e.preventDefault();
      move(e.shiftKey ? -1 : 1);
    }
  }

  function move(d) {
    if (!items.length) return;
    kbNavAt = Date.now();
    active = (active + d + items.length) % items.length;
    // Only re-highlight; re-rendering the whole list on every keypress is what
    // let a stationary mouse's mouseenter yank the selection back ("stuck").
    highlight();
  }

  function confirm() {
    run(active);
  }

  function render(keepQuery) {
    const q = input.value.trim();
    const scored = (chooseItems || commands.all())
      .map((cmd) => ({ cmd, s: score(q, title(cmd) + " " + (cmd.searchText || "") + " " + (cmd.group || "")) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    items = scored.map((x) => x.cmd);
    if (!keepQuery) active = 0;
    if (active >= items.length) active = 0;

    results.innerHTML = "";
    if (!items.length) {
      results.innerHTML = `<div class="inboxkeys-empty">No matching commands</div>`;
      return;
    }
    let lastGroup = null;
    items.forEach((cmd, i) => {
      if (cmd.group && cmd.group !== lastGroup) {
        const h = document.createElement("div");
        h.className = "inboxkeys-group";
        h.textContent = cmd.group;
        results.appendChild(h);
        lastGroup = cmd.group;
      }
      const row = document.createElement("div");
      row.className = "inboxkeys-row" + (i === active ? " inboxkeys-row--active" : "");
      row.dataset.i = i;
      const keys = (cmd.keys || []).map((k) => `<kbd>${escapeHtml(keyLabel(k))}</kbd>`).join("");
      row.innerHTML = `
        <span class="inboxkeys-row-title">${escapeHtml(title(cmd))}</span>
        <span class="inboxkeys-row-keys">${cmd.hint ? `<span class="inboxkeys-hint">${escapeHtml(cmd.hint)}</span>` : ""}${keys}</span>`;
      row.addEventListener("mouseenter", () => {
        if (Date.now() - kbNavAt < 250) return; // keyboard nav wins briefly
        active = i;
        highlight();
      });
      row.addEventListener("click", () => run(i));
      results.appendChild(row);
    });
    highlight();
  }

  function highlight() {
    results.querySelectorAll(".inboxkeys-row").forEach((r) => {
      r.classList.toggle("inboxkeys-row--active", parseInt(r.dataset.i, 10) === active);
    });
    const el = results.querySelector(".inboxkeys-row--active");
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function run(i) {
    const cmd = items[i];
    if (!cmd) return;
    hide();
    // Defer so the palette is fully gone before Gmail handles focus/keys.
    setTimeout(() => {
      try {
        cmd.run();
      } catch (err) {
        console.error("[InboxKeys] command failed", cmd.id, err);
        InboxKeys.toast("Command failed: " + (cmd.id || "unknown"), { kind: "warn" });
      }
    }, 30);
  }

  function openWith(placeholder, promptLabel) {
    build();
    open = true;
    root.classList.add("inboxkeys-overlay--open");
    input.placeholder = placeholder;
    root.querySelector(".inboxkeys-prompt").textContent = promptLabel;
    input.value = "";
    render();
    setTimeout(() => input.focus(), 0);
  }

  function show() {
    chooseItems = null;
    openWith("Type a command or search…", keyLabel("Mod+K"));
  }

  // One-shot picker over arbitrary command-shaped items ({title, group, hint,
  // searchText, run}) — same overlay, fuzzy filter, and engine key routing as
  // the command palette (isOpen() covers both, so hotkeys.js needs nothing new).
  function choose(opts) {
    chooseItems = (opts && opts.items) || [];
    openWith((opts && opts.placeholder) || "Filter…", (opts && opts.prompt) || "");
  }

  function hide() {
    if (!root) return;
    open = false;
    chooseItems = null;
    root.classList.remove("inboxkeys-overlay--open");
    input.blur();
  }

  function toggle() {
    open ? hide() : show();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  InboxKeys.palette = { show, hide, toggle, choose, isOpen: () => open, move, confirm };
})();
