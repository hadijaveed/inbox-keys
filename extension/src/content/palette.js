// The Cmd+K command palette: an injected overlay with fuzzy search over the
// command registry.
window.CMDK = window.CMDK || {};

(function () {
  const { commands, storage } = CMDK;

  let root, input, list, results, open = false;
  let items = [];
  let active = 0;
  let kbNavAt = 0; // timestamp of the last keyboard move, to ignore stray mouseenter

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

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "cmdk-overlay";
    root.innerHTML = `
      <div class="cmdk-modal" role="dialog" aria-label="Command palette">
        <div class="cmdk-input-row">
          <span class="cmdk-prompt">⌘K</span>
          <input class="cmdk-input" placeholder="Type a command or search…" autocomplete="off" spellcheck="false" />
        </div>
        <div class="cmdk-results"></div>
        <div class="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>`;
    document.documentElement.appendChild(root);
    input = root.querySelector(".cmdk-input");
    results = root.querySelector(".cmdk-results");

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
    const scored = commands
      .all()
      .map((cmd) => ({ cmd, s: score(q, title(cmd) + " " + (cmd.group || "")) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    items = scored.map((x) => x.cmd);
    if (!keepQuery) active = 0;
    if (active >= items.length) active = 0;

    results.innerHTML = "";
    if (!items.length) {
      results.innerHTML = `<div class="cmdk-empty">No matching commands</div>`;
      return;
    }
    let lastGroup = null;
    items.forEach((cmd, i) => {
      if (cmd.group && cmd.group !== lastGroup) {
        const h = document.createElement("div");
        h.className = "cmdk-group";
        h.textContent = cmd.group;
        results.appendChild(h);
        lastGroup = cmd.group;
      }
      const row = document.createElement("div");
      row.className = "cmdk-row" + (i === active ? " cmdk-row--active" : "");
      row.dataset.i = i;
      const keys = (cmd.keys || []).map((k) => `<kbd>${k}</kbd>`).join("");
      row.innerHTML = `
        <span class="cmdk-row-title">${escapeHtml(title(cmd))}</span>
        <span class="cmdk-row-keys">${cmd.hint ? `<span class="cmdk-hint">${escapeHtml(cmd.hint)}</span>` : ""}${keys}</span>`;
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
    results.querySelectorAll(".cmdk-row").forEach((r) => {
      r.classList.toggle("cmdk-row--active", parseInt(r.dataset.i, 10) === active);
    });
    const el = results.querySelector(".cmdk-row--active");
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
        console.error("[CMDK] command failed", cmd.id, err);
        CMDK.toast("Command failed: " + (cmd.id || "unknown"), { kind: "warn" });
      }
    }, 30);
  }

  function show() {
    build();
    open = true;
    root.classList.add("cmdk-overlay--open");
    input.value = "";
    render();
    setTimeout(() => input.focus(), 0);
  }

  function hide() {
    if (!root) return;
    open = false;
    root.classList.remove("cmdk-overlay--open");
    input.blur();
  }

  function toggle() {
    open ? hide() : show();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  CMDK.palette = { show, hide, toggle, isOpen: () => open, move, confirm };
})();
