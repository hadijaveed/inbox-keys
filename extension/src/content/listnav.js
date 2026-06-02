// List cursor + multi-select for the thread list (inbox / search / label).
//
// Gmail ignores synthetic j/k/x/Enter keystrokes (they're untrusted), so we
// can't reuse Gmail's own keyboard cursor. Instead we maintain our OWN cursor
// over the visible thread rows (tr.zA) and drive selection / triage by clicking
// the rows' real controls: the [role="checkbox"], the per-row hover buttons,
// and the toolbar (which acts on the checked set). All clicks go through
// gmail.realClick (full pointer+mouse gesture) so Gmail actually reacts.
window.OpenSuperhuman = window.OpenSuperhuman || {};

(function () {
  const { gmail } = OpenSuperhuman;
  const CURSOR_CLASS = "open-superhuman-cursor";
  let cursor = -1;
  let anchor = -1; // shift-select range anchor; -1 means no shift session active

  function rows() {
    return Array.from(document.querySelectorAll("tr.zA")).filter((r) => gmail.isVisible(r));
  }

  // Keep the cursor valid: reuse it if still in range, else adopt Gmail's own
  // highlighted row (.btb) if any, else the first row.
  function ensureCursor(list) {
    const r = list || rows();
    if (cursor >= 0 && cursor < r.length) return cursor;
    const btb = r.findIndex((row) => row.classList.contains("btb"));
    cursor = r.length ? (btb >= 0 ? btb : 0) : -1;
    return cursor;
  }

  function paint(list) {
    const r = list || rows();
    r.forEach((row, i) => row.classList.toggle(CURSOR_CLASS, i === cursor));
    const el = r[cursor];
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function move(dir) {
    const r = rows();
    if (!r.length) return;
    ensureCursor(r);
    anchor = -1; // a plain move ends any shift-select range
    cursor = Math.max(0, Math.min(cursor + dir, r.length - 1));
    paint(r);
  }

  function cursorRow() {
    const r = rows();
    ensureCursor(r);
    return r[cursor] || null;
  }

  function checkbox(row) {
    return row ? row.querySelector('[role="checkbox"]') : null;
  }
  function isSelected(row) {
    const cb = checkbox(row);
    return cb ? cb.getAttribute("aria-checked") === "true" : false;
  }
  function setSelected(row, want) {
    if (row && isSelected(row) !== want) gmail.realClick(checkbox(row));
  }
  function selectedRows() {
    return rows().filter(isSelected);
  }

  function toggleSelect() {
    anchor = -1; // a manual toggle starts a fresh selection session
    const row = cursorRow();
    if (row) setSelected(row, !isSelected(row));
  }

  // Deselect everything (Escape) so you don't have to click away.
  function clearSelection() {
    anchor = -1;
    const sel = selectedRows();
    sel.forEach((row) => setSelected(row, false));
    return sel.length;
  }

  // Shift+Arrow: grow OR shrink a contiguous range anchored where the shift-select
  // began. The selection is always the rows between the anchor and the cursor, so
  // moving back toward the anchor DEselects the row you leave — Shift+Up after a
  // run of Shift+Down unselects upward (and vice-versa) instead of only ever
  // adding rows.
  function extend(dir) {
    const r = rows();
    if (!r.length) return;
    ensureCursor(r);
    if (anchor < 0) {
      anchor = cursor; // first shift press: anchor here and select it
      setSelected(r[anchor], true);
    }
    const prev = cursor;
    cursor = Math.max(0, Math.min(cursor + dir, r.length - 1));
    const lo = Math.min(anchor, cursor);
    const hi = Math.max(anchor, cursor);
    for (let i = lo; i <= hi; i++) setSelected(r[i], true);
    if (prev < lo || prev > hi) setSelected(r[prev], false); // left the range
    paint(r);
  }

  function open() {
    const row = cursorRow();
    if (!row) return;
    const target = row.querySelector('.xS, .bog, span[data-thread-id], [role="link"]') || row;
    gmail.realClick(target);
  }

  // A visible toolbar button (acts on the checked set) by exact label.
  function toolbarButton(label) {
    const bars = Array.from(
      document.querySelectorAll('[gh="tm"], [gh="mtb"], [role="toolbar"]')
    ).filter((b) => gmail.isVisible(b));
    for (const bar of bars) {
      const btn = Array.from(
        bar.querySelectorAll(`[aria-label="${label}"], [data-tooltip="${label}"]`)
      ).filter((b) => gmail.isVisible(b))[0];
      if (btn) return btn;
    }
    return null;
  }

  function toolbarButtonMatching(patterns) {
    const bars = Array.from(
      document.querySelectorAll('[gh="tm"], [gh="mtb"], [role="toolbar"]')
    ).filter((b) => gmail.isVisible(b));
    for (const bar of bars) {
      const btn = Array.from(
        bar.querySelectorAll('[aria-label], [data-tooltip], [title], [role="button"]')
      ).filter((b) => gmail.isVisible(b)).find((b) => {
        const label = (
          b.getAttribute("aria-label") ||
          b.getAttribute("data-tooltip") ||
          b.getAttribute("title") ||
          b.textContent ||
          ""
        ).trim();
        return patterns.some((p) => p.test(label));
      });
      if (btn) return btn;
    }
    return null;
  }

  function waitFor(find, onFound, onGiveUp, tries = 16, interval = 80) {
    const el = find();
    if (el) return onFound(el);
    if (tries <= 0) return onGiveUp && onGiveUp();
    setTimeout(() => waitFor(find, onFound, onGiveUp, tries - 1, interval), interval);
    return true;
  }

  function rowButton(row, label) {
    if (!row) return null;
    return (
      Array.from(row.querySelectorAll('[role="button"]')).find((b) => {
        const l = b.getAttribute("aria-label") || b.getAttribute("data-tooltip") || "";
        return new RegExp("^" + label + "$", "i").test(l);
      }) || null
    );
  }

  function rowButtonMatching(row, patterns) {
    if (!row) return null;
    return (
      Array.from(row.querySelectorAll('[aria-label], [data-tooltip], [title], [role="button"]')).find((b) => {
        const label = (
          b.getAttribute("aria-label") ||
          b.getAttribute("data-tooltip") ||
          b.getAttribute("title") ||
          b.textContent ||
          ""
        ).trim();
        return patterns.some((p) => p.test(label));
      }) || null
    );
  }

  // Archive: selected rows via the toolbar; otherwise the cursor row. Prefer the
  // row's own hover button when it's actually laid out, else select-then-toolbar
  // (the toolbar only renders its action icons once something is checked).
  function archive() {
    if (selectedRows().length) {
      const b = toolbarButton("Archive");
      if (b) gmail.realClick(b);
      setTimeout(() => paint(), 200);
      return;
    }
    const row = cursorRow();
    if (!row) return;
    const rb = rowButton(row, "Archive");
    if (rb && gmail.isVisible(rb)) {
      gmail.realClick(rb);
      setTimeout(() => paint(), 200);
      return;
    }
    setSelected(row, true);
    setTimeout(() => {
      const b = toolbarButton("Archive");
      if (b) gmail.realClick(b);
      setTimeout(() => paint(), 200);
    }, 70);
  }

  function trash() {
    if (selectedRows().length) {
      const b = toolbarButton("Delete") || toolbarButton("Trash");
      if (b) gmail.realClick(b);
      setTimeout(() => paint(), 200);
      return;
    }
    const row = cursorRow();
    if (!row) return;
    const rb = rowButtonMatching(row, [/^Delete$/i, /^Trash$/i]);
    if (rb && gmail.isVisible(rb)) {
      gmail.realClick(rb);
      setTimeout(() => paint(), 200);
      return;
    }
    setSelected(row, true);
    setTimeout(() => {
      const b = toolbarButton("Delete") || toolbarButton("Trash");
      if (b) gmail.realClick(b);
      setTimeout(() => paint(), 200);
    }, 70);
  }

  function toggleStar() {
    const row = cursorRow();
    const star = rowButtonMatching(row, [
      /^Star$/i,
      /^Not starred$/i,
      /^Add star$/i,
      /^Remove star$/i,
      /^Starred$/i,
    ]);
    if (star && gmail.isVisible(star)) gmail.realClick(star);
  }

  const READ_PATTERNS = [/^Mark as read$/i, /^Mark as unread$/i, /^Mark read$/i, /^Mark unread$/i];

  function markReadUnread() {
    if (selectedRows().length) {
      const b = toolbarButtonMatching(READ_PATTERNS);
      if (b) gmail.realClick(b);
      setTimeout(() => paint(), 200);
      return true;
    }
    const row = cursorRow();
    if (!row) return false;
    const rb = rowButtonMatching(row, READ_PATTERNS);
    if (rb && gmail.isVisible(rb)) {
      gmail.realClick(rb);
      setTimeout(() => paint(), 200);
      return true;
    }
    setSelected(row, true);
    return waitFor(
      () => toolbarButtonMatching(READ_PATTERNS),
      (b) => {
        gmail.realClick(b);
        setTimeout(() => {
          setSelected(row, false);
          paint();
        }, 120);
      },
      () => setSelected(row, false)
    );
  }

  function withSelection(action) {
    if (selectedRows().length) {
      action();
      return true;
    }
    const row = cursorRow();
    if (!row) return false;
    setSelected(row, true);
    setTimeout(action, 70);
    return true;
  }

  function withTemporarySelection(action) {
    if (selectedRows().length) {
      action();
      return true;
    }
    const row = cursorRow();
    if (!row) return false;
    setSelected(row, true);
    const ran = action();
    if (ran) {
      setSelected(row, false);
      return true;
    }
    setTimeout(() => {
      action();
      setTimeout(() => setSelected(row, false), 120);
    }, 70);
    return true;
  }

  function reset() {
    cursor = -1;
    anchor = -1;
  }

  // A fresh list (navigation, account switch) should start the cursor over.
  window.addEventListener("hashchange", reset);

  OpenSuperhuman.listnav = { move, extend, open, toggleSelect, selectedRows, clearSelection, archive, trash, toggleStar, markReadUnread, withSelection, withTemporarySelection, reset };
})();
