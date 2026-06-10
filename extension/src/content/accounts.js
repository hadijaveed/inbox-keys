// Account detection + switching.
//
// Gmail multi-login lives at /mail/u/<index>/. We learn which email maps to
// which index as the user visits each account, persist it, and offer fast
// switching from the palette.
window.Mailpalette = window.Mailpalette || {};

(function () {
  const { gmail, storage } = Mailpalette;

  async function rememberCurrent() {
    const idx = String(gmail.accountIndex());
    const email = gmail.currentEmail();
    if (!email) return;
    const names = { ...(storage.get("accountNames") || {}) };
    if (names[idx] !== email) {
      names[idx] = email;
      await storage.set({ accountNames: names });
    }
  }

  function known() {
    const names = storage.get("accountNames") || {};
    return Object.entries(names)
      .map(([idx, email]) => ({ index: parseInt(idx, 10), email }))
      .sort((a, b) => a.index - b.index);
  }

  function switchTo(index) {
    if (index === gmail.accountIndex()) {
      Mailpalette.toast("Already on this account");
      return;
    }
    // Preserve the current section, but drop any open thread id — that id won't
    // exist in the other account, so land on the list view instead.
    const hash = Mailpalette.hashutil.parentHash(location.hash || "#inbox");
    // Real navigation (trusted) — Gmail's own multi-login switch.
    location.href = `/mail/u/${index}/${hash}`;
  }

  function next() {
    const list = known();
    if (list.length < 2) {
      // We may not have learned other accounts yet; nudge to the next index.
      switchTo(gmail.accountIndex() + 1);
      return;
    }
    const cur = gmail.accountIndex();
    const pos = list.findIndex((a) => a.index === cur);
    const nxt = list[(pos + 1) % list.length];
    switchTo(nxt.index);
  }

  // ---- Configure accounts modal -----------------------------------------
  // Gmail's account chooser is a cross-origin iframe we can't read, so we let
  // the user list their accounts once: row N maps to /mail/u/N. Stored in
  // accountNames and surfaced in the palette + the g 0–g 8 chords.

  let cfg = null;

  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function openConfig() {
    if (cfg) {
      closeConfig();
      return;
    }
    const names = storage.get("accountNames") || {};
    const maxLearned = Object.keys(names).reduce((m, k) => Math.max(m, parseInt(k, 10)), gmail.accountIndex());
    // Seed rows for every slot up to the highest known (min 3 rows to start).
    const count = Math.max(3, maxLearned + 1);
    const working = [];
    for (let i = 0; i < count; i++) working.push({ index: i, email: names[String(i)] || "" });

    cfg = document.createElement("div");
    cfg.className = "mailpalette-overlay mailpalette-overlay--open mailpalette-cfg-overlay";
    cfg.innerHTML = `
      <div class="mailpalette-modal mailpalette-cfg" role="dialog" aria-label="Configure accounts">
        <div class="mailpalette-cfg-head">
          <div>
            <div class="mailpalette-cfg-title">Accounts</div>
            <div class="mailpalette-cfg-sub">Each row is a signed-in Google account. Order matches Gmail's <code>/u/0</code>, <code>/u/1</code>… Switch with <code>g 0</code>–<code>g 8</code> or from the palette.</div>
          </div>
          <button class="mailpalette-cfg-x" aria-label="Close">esc</button>
        </div>
        <div class="mailpalette-cfg-list"></div>
        <button class="mailpalette-cfg-add">+ Add account</button>
        <div class="mailpalette-cfg-foot">
          <span class="mailpalette-cfg-hint">Tip: <code>g</code> then the number jumps to that account anywhere in Gmail.</span>
          <span>
            <button class="mailpalette-btn mailpalette-btn--ghost mailpalette-cfg-cancel">Cancel</button>
            <button class="mailpalette-btn mailpalette-cfg-save">Save</button>
          </span>
        </div>
      </div>`;
    document.documentElement.appendChild(cfg);

    const list = cfg.querySelector(".mailpalette-cfg-list");
    const cur = gmail.accountIndex();

    function renderRows() {
      list.innerHTML = "";
      working.forEach((acc, i) => {
        const row = document.createElement("div");
        row.className = "mailpalette-cfg-row";
        row.innerHTML = `
          <span class="mailpalette-cfg-acct-key">g ${acc.index}${acc.index === cur ? " ·" : ""}</span>
          <input class="mailpalette-cfg-query mailpalette-cfg-acct-email" value="${escapeAttr(acc.email)}" placeholder="name@gmail.com (account u/${acc.index})" />
          <button class="mailpalette-cfg-del" title="Remove">✕</button>`;
        row.querySelector(".mailpalette-cfg-acct-email").addEventListener("input", (e) => (working[i].email = e.target.value.trim()));
        row.querySelector(".mailpalette-cfg-del").addEventListener("click", () => {
          working.splice(i, 1);
          working.forEach((a, n) => (a.index = n)); // reindex: rows are positional
          renderRows();
        });
        list.appendChild(row);
      });
    }
    renderRows();

    cfg.querySelector(".mailpalette-cfg-add").addEventListener("click", () => {
      working.push({ index: working.length, email: "" });
      renderRows();
    });
    cfg.querySelector(".mailpalette-cfg-cancel").addEventListener("click", closeConfig);
    cfg.querySelector(".mailpalette-cfg-x").addEventListener("click", closeConfig);
    cfg.querySelector(".mailpalette-cfg-save").addEventListener("click", async () => {
      const map = {};
      working.forEach((a, i) => {
        if (a.email) map[String(i)] = a.email;
      });
      await storage.set({ accountNames: map });
      closeConfig();
      Mailpalette.toast("Accounts saved");
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

  Mailpalette.accounts = { rememberCurrent, known, switchTo, next, openConfig };
})();
