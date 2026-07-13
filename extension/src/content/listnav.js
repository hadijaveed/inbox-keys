// List cursor + multi-select for the thread list (inbox / search / label).
//
// Gmail ignores synthetic j/k/x/Enter keystrokes (they're untrusted), so we
// can't reuse Gmail's own keyboard cursor. Instead we maintain our OWN cursor
// over the visible thread rows (tr.zA) and drive selection / triage by clicking
// the rows' real controls: the [role="checkbox"], the per-row hover buttons,
// and the toolbar (which acts on the checked set). All clicks go through
// gmail.realClick (full pointer+mouse gesture) so Gmail actually reacts.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const { gmail } = InboxKeys;
  const CURSOR_CLASS = "inboxkeys-cursor";
  let cursor = -1;
  let anchor = -1; // shift-select range anchor; -1 means no shift session active
  // "Act on the row I'm pointing at." A monotonic counter orders the two ways the
  // target can change: hovering a row with the mouse, or moving with j/k. Whichever
  // happened more recently wins as the target for e/x/Enter, so archiving works on
  // the row you're actually looking at — not a stale top-of-list cursor. A counter
  // (not a timestamp) keeps the ordering exact even for events in the same tick.
  let hoverRow = null;
  let evSeq = 0;
  let hoverSeq = 0;
  let keyNavSeq = 0;

  function rows() {
    const r = Array.from(document.querySelectorAll(gmail.SEL.listRow)).filter((row) => gmail.isVisible(row));
    if (r.length) return r;
    // Structural fallback: if Gmail ever renames .zA, any visible row inside
    // the thread-list area that carries a per-row checkbox is a thread row.
    // Keeps j/k/x/e/Enter alive through a class rename instead of dying with it.
    return Array.from(document.querySelectorAll(gmail.SEL.listRowFallback)).filter(
      (row) => gmail.isVisible(row) && row.querySelector(gmail.SEL.rowCheckbox)
    );
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

  function paint(list, scrollBlock = "nearest") {
    const r = list || rows();
    r.forEach((row, i) => row.classList.toggle(CURSOR_CLASS, i === cursor));
    const el = r[cursor];
    if (el) el.scrollIntoView({ block: scrollBlock });
  }

  // After a triage action removes rows (archive / delete), keep the cursor on
  // the same list POSITION: the row that shifts up into the removed row's slot
  // is the natural next target, so "e e e" walks the list. Gmail removes rows
  // ASYNCHRONOUSLY and often re-renders the whole list (all new nodes), so a
  // bare integer cursor either pointed past the end (ensureCursor then snapped
  // it to .btb or row 0 — the "cursor jumps to the top after e" bug) or got
  // painted on a doomed DOM generation. Wait for the removed rows to actually
  // leave a non-empty list, then clamp the saved index into the new row set and
  // re-pin through Gmail's settling re-renders (same trick as restoreReturn).
  // Guarded by keyNavSeq: the moment the user navigates again, stand down.
  function reanchorAfterRemoval(removed, idx) {
    hoverRow = null; // rows are about to shift under a stationary pointer
    keyNavSeq = ++evSeq; // the user acted; keyboard owns the cursor again
    const seqAtAction = keyNavSeq;
    const apply = () => {
      if (keyNavSeq !== seqAtAction) return;
      const r = rows();
      if (!r.length) return;
      cursor = Math.max(0, Math.min(idx, r.length - 1));
      paint(r);
    };
    waitFor(
      () => {
        const r = rows();
        return r.length && removed.every((row) => !r.includes(row)) ? true : null;
      },
      () => {
        apply();
        setTimeout(apply, 150);
        setTimeout(apply, 400);
      },
      () => paint() // rows never left (action failed / boundary): repaint as before
    );
  }

  // The list position an action on `row` (or the checked set) should re-anchor
  // to: the topmost removed row's index, i.e. where the survivors slide up to.
  function removalIndex(targets) {
    const r = rows();
    const idxs = targets.map((row) => r.indexOf(row)).filter((i) => i >= 0);
    return idxs.length ? Math.min(...idxs) : Math.max(cursor, 0);
  }

  function focusEdge(dir) {
    const r = rows();
    if (!r.length) return false;
    keyNavSeq = ++evSeq;
    anchor = -1;
    hoverRow = null;
    cursor = dir < 0 ? 0 : r.length - 1;
    paint(r, dir < 0 ? "start" : "end");
    return true;
  }

  function focusTop() {
    return focusEdge(-1);
  }

  function focusBottom() {
    return focusEdge(1);
  }

  function syncEdgeAfterScroll(dir) {
    focusEdge(dir);
    setTimeout(() => focusEdge(dir), 80);
    setTimeout(() => focusEdge(dir), 220);
  }

  // Page the list forward (older) / back (newer) via Gmail's pager, then pin the
  // NEW page to the top with the cursor on the first row. Gmail loads the next
  // page asynchronously and leaves the scroll where it was (often near the
  // bottom, since the pager is reached from there), so we must wait for the page
  // to actually change before scrolling — otherwise we'd scroll the old page,
  // which Gmail then replaces. The signal that the page turned is the hash
  // gaining/losing its trailing /pN segment. At a boundary (first/last page) the
  // pager is a no-op and the hash never changes, so waitFor just gives up and
  // nothing moves. Re-pinning a couple of times covers Gmail's post-load
  // re-render settling the scroll back down.
  function page(dir) {
    const before = location.hash;
    const ok = dir > 0 ? gmail.nextPage() : gmail.prevPage();
    const pinTop = () => {
      gmail.listScrollTop();
      focusEdge(-1);
    };
    waitFor(
      () => (location.hash !== before && rows().length ? true : null),
      () => {
        pinTop();
        setTimeout(pinTop, 120);
        setTimeout(pinTop, 320);
      },
      () => {}
    );
    return ok;
  }

  function move(dir) {
    const r = rows();
    if (!r.length) return;
    keyNavSeq = ++evSeq; // keyboard navigation now owns the cursor
    ensureCursor(r);
    anchor = -1; // a plain move ends any shift-select range
    cursor = Math.max(0, Math.min(cursor + dir, r.length - 1));
    paint(r);
  }

  // The row a single-row action (e/x/Enter) should target. If the mouse hovered a
  // visible row more recently than the last keyboard move, that's the row the user
  // means; otherwise fall back to the keyboard cursor. Syncs the cursor to the
  // hovered row so the visible cursor and subsequent j/k continue from there.
  function cursorRow() {
    const r = rows();
    if (hoverRow && hoverSeq > keyNavSeq && r.indexOf(hoverRow) !== -1 && gmail.isVisible(hoverRow)) {
      cursor = r.indexOf(hoverRow);
      return hoverRow;
    }
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
    keyNavSeq = ++evSeq; // keyboard navigation now owns the cursor
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
    pendingReturnState = captureReturnState(location.hash || "#inbox", row);
    gmail.realClick(target);
    setTimeout(() => {
      if (pendingReturnState && !InboxKeys.hashutil.hashIsThread(location.hash || "")) {
        pendingReturnState = null;
      }
    }, 1500);
  }

  // Gmail disables a toolbar control with aria-disabled="true" (e.g. Archive when
  // the selected mail isn't in the Inbox, so there's nothing to remove from it).
  // realClick on a dead button does nothing, so never treat one as actionable.
  function isEnabled(el) {
    return !!el && el.getAttribute("aria-disabled") !== "true";
  }

  // A visible toolbar button (acts on the checked set) by exact label.
  function toolbarButton(label) {
    const bars = Array.from(
      document.querySelectorAll(gmail.SEL.toolbars)
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
      document.querySelectorAll(gmail.SEL.toolbars)
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

  function cannotArchive() {
    if (InboxKeys.toast) {
      InboxKeys.toast("Not in Inbox, nothing to archive", { kind: "warn" });
    }
  }

  // Click a row's own hover Archive button. Gmail keeps that button in the DOM
  // but sized 0x0 until the row is hovered, so reveal it first (we navigate by
  // keyboard and never move the real pointer). Returns true if it actually
  // clicked an enabled per-row Archive.
  function clickPerRowArchive(row) {
    if (!row) return false;
    gmail.hover(row);
    // Gmail's per-row Archive is an <li data-tooltip="Archive"> with NO
    // role="button", so match by label across any element (rowButtonMatching),
    // not rowButton, which only looks at [role="button"] and would miss it.
    const rb = rowButtonMatching(row, [/^Archive$/i]);
    if (rb && gmail.isVisible(rb) && isEnabled(rb)) {
      gmail.realClick(rb);
      return true;
    }
    return false;
  }

  // Archive the cursor row (or the whole checked set). The per-row hover Archive
  // is the control to trust: the *toolbar* Archive is disabled in a Priority
  // ("Important first") inbox and on search/all-mail results that aren't in the
  // Inbox, so the old "select then click the toolbar" path clicked a dead button
  // — the row got selected and nothing happened ("e selects but doesn't
  // archive"). So drive the per-row button, and only fall back to the toolbar
  // when there's no per-row Archive at all. If even that is disabled (the mail
  // genuinely isn't in the Inbox — Gmail offers "Move to Inbox" instead), drop
  // the selection we made and say why rather than driving a dead control.
  function archive() {
    const sel = selectedRows();
    if (sel.length) {
      // Bulk: the toolbar acts on the whole checked set in one shot when it's
      // enabled; otherwise archive each selected row through its hover button.
      const idx = removalIndex(sel);
      const b = toolbarButton("Archive");
      if (isEnabled(b)) {
        gmail.realClick(b);
        reanchorAfterRemoval(sel, idx);
        return;
      }
      const n = sel.map((row) => clickPerRowArchive(row)).filter(Boolean).length;
      if (!n) {
        cannotArchive();
        setTimeout(() => paint(), 200);
        return;
      }
      reanchorAfterRemoval(sel, idx);
      return;
    }
    const row = cursorRow();
    if (!row) return;
    const idx = removalIndex([row]);
    if (clickPerRowArchive(row)) {
      reanchorAfterRemoval([row], idx);
      return;
    }
    setSelected(row, true);
    waitFor(
      () => toolbarButton("Archive"),
      (b) => {
        if (!isEnabled(b)) {
          setSelected(row, false);
          cannotArchive();
          paint();
          return;
        }
        gmail.realClick(b);
        reanchorAfterRemoval([row], idx);
      },
      () => setSelected(row, false)
    );
  }

  function trash() {
    const sel = selectedRows();
    if (sel.length) {
      const idx = removalIndex(sel);
      const b = toolbarButton("Delete") || toolbarButton("Trash");
      if (b) gmail.realClick(b);
      reanchorAfterRemoval(sel, idx);
      return;
    }
    const row = cursorRow();
    if (!row) return;
    const idx = removalIndex([row]);
    const rb = rowButtonMatching(row, [/^Delete$/i, /^Trash$/i]);
    if (rb && gmail.isVisible(rb)) {
      gmail.realClick(rb);
      reanchorAfterRemoval([row], idx);
      return;
    }
    setSelected(row, true);
    setTimeout(() => {
      const b = toolbarButton("Delete") || toolbarButton("Trash");
      if (b) gmail.realClick(b);
      reanchorAfterRemoval([row], idx);
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
  const SNOOZE_PATTERNS = [/^Snooze\b/i, /^Remind me\b/i];

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

  function snooze() {
    const sel = selectedRows();
    if (sel.length > 1) {
      const b = toolbarButtonMatching(SNOOZE_PATTERNS);
      if (b) return gmail.realClick(b);
      return gmail.snooze();
    }
    const row = cursorRow();
    if (!row) return false;
    sel.forEach((selected) => {
      if (selected !== row) setSelected(selected, false);
    });
    setSelected(row, true);
    return waitFor(
      () => toolbarButtonMatching(SNOOZE_PATTERNS),
      (b) => gmail.realClick(b),
      () => gmail.snooze()
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
    hoverRow = null;
    evSeq = 0;
    hoverSeq = 0;
    keyNavSeq = 0;
  }

  // Track the row the mouse is over so single-row actions can target "the row I'm
  // pointing at." Two kinds of mouseover must NOT become the target:
  //
  // 1. Our own synthetic hover: gmail.hover(row) fires mouseover to reveal the
  //    per-row buttons before archiving. Filtered by gmail.isSynthesizingHover().
  // 2. The browser's PHANTOM mouseover: when Gmail removes/re-renders rows under
  //    a STATIONARY pointer (right after an archive), the browser fires a real,
  //    trusted mouseover on whatever row lands under the mouse — zero user
  //    intent. That row then silently owned the next e/x/Enter, the reported
  //    "cursor loses its position when I press e" bug. A human hover is always
  //    accompanied by mousemove and a phantom never is, so a row only becomes
  //    the hover target when the mouse actually moved just before the mouseover.
  let lastMoveAt = 0;
  document.addEventListener(
    "mousemove",
    () => {
      if (gmail.isSynthesizingHover && gmail.isSynthesizingHover()) return;
      lastMoveAt = Date.now();
    },
    true
  );
  document.addEventListener(
    "mouseover",
    (e) => {
      if (gmail.isSynthesizingHover && gmail.isSynthesizingHover()) return;
      if (Date.now() - lastMoveAt > 300) return; // no recent real movement: a re-render phantom
      const row = e.target && e.target.closest ? e.target.closest("tr.zA") : null;
      if (row) {
        hoverRow = row;
        hoverSeq = ++evSeq;
      }
    },
    true
  );

  // Returning from a thread must land you back where you left the list: same
  // cursor row, same scroll offset. Gmail re-renders the list at the TOP after
  // the hash navigates back from a thread, and the old blanket reset() on every
  // hashchange threw the cursor away too — the reported "Escape sends me back
  // to the top" bug. So: save cursor + scroll when the hash dives from a list
  // into one of its threads, keep the save while moving between threads of the
  // same list (next/prev thread), and restore when the hash returns to that
  // exact list. Any other navigation (different list, tab or account switch)
  // still starts the cursor over.
  let returnState = null; // { parent, cursor, scrollTop }
  let pendingReturnState = null;
  let lastHash = location.hash;

  // The opened conversation's id, read straight off its list row. Used to re-find
  // the same row on return even if the list shifted (new mail) while we were in
  // the thread; falls back to the saved index when absent.
  function threadIdOf(row) {
    if (!row) return null;
    const el = row.querySelector("[data-thread-id]");
    return (el && el.getAttribute("data-thread-id")) || row.getAttribute("data-legacy-thread-id") || null;
  }

  function captureReturnState(parent, row) {
    const sc = gmail.listScrollContainer();
    const anchorRow = row || (cursor >= 0 ? rows()[cursor] : null);
    return { parent, cursor, threadId: threadIdOf(anchorRow), scrollTop: sc ? sc.scrollTop : 0 };
  }

  function restoreReturn(want) {
    // Re-pin only until the user takes over with the KEYBOARD (j/k, Shift+arrow,
    // g/G). This used to guard on evSeq, but the passive mouseover handler also
    // bumps evSeq — and Gmail fires mouseover on the rows it re-renders under a
    // still pointer the moment you return, so the guard tripped on its own and
    // every re-pin below bailed, letting Gmail's scroll-to-top win (the reported
    // "cursor/scroll jumps somewhere else"). keyNavSeq advances only on real
    // keyboard navigation, so a re-render mouseover no longer aborts the restore.
    const seqAtRestore = keyNavSeq;
    const apply = () => {
      if (keyNavSeq !== seqAtRestore) return;
      const r = rows();
      if (!r.length) return;
      // Prefer the row we actually opened (matched by thread id); fall back to
      // the saved index if Gmail dropped the id or the row is gone.
      let idx = want.cursor;
      if (want.threadId) {
        const found = r.findIndex((row) => threadIdOf(row) === want.threadId);
        if (found >= 0) idx = found;
      }
      cursor = idx >= 0 ? Math.min(idx, r.length - 1) : -1;
      // Paint by hand (no scrollIntoView) so the cursor highlight can't fight
      // the scroll restore below.
      r.forEach((row, i) => row.classList.toggle(CURSOR_CLASS, i === cursor));
      const sc = gmail.listScrollContainer();
      if (sc) sc.scrollTop = want.scrollTop;
    };
    waitFor(
      () => (rows().length ? true : null),
      () => {
        apply();
        // Gmail keeps re-rendering the restored list for a beat and settles the
        // scroll back to the top; re-pin through it (same trick as page()).
        setTimeout(apply, 120);
        setTimeout(apply, 320);
        setTimeout(apply, 600);
      },
      () => {}
    );
  }

  window.addEventListener("hashchange", () => {
    const prev = lastHash;
    const now = location.hash;
    lastHash = now;
    const { hashutil } = InboxKeys;
    if (hashutil.hashIsThread(now)) {
      const parent = hashutil.parentHash(now);
      if (pendingReturnState && pendingReturnState.parent === parent) {
        // The list was still intact when Enter clicked the row. Trust that
        // snapshot; Gmail may have already rebuilt the DOM by this hashchange.
        returnState = pendingReturnState;
        pendingReturnState = null;
      } else if (parent === prev) {
        // Dove from a list into one of its threads by some path other than our
        // Enter handler: remember where we were if the list is still readable.
        returnState = captureReturnState(prev);
      } else if (!(returnState && hashutil.parentHash(now) === returnState.parent)) {
        // A thread of some OTHER list: the save no longer applies.
        returnState = null;
        pendingReturnState = null;
      }
      return; // the list cursor is dormant inside a thread; nothing to reset
    }
    pendingReturnState = null;
    if (returnState && now === returnState.parent) {
      const want = returnState;
      returnState = null;
      reset();
      restoreReturn(want);
      return;
    }
    // A fresh list (navigation, account switch) starts the cursor over.
    returnState = null;
    reset();
  });

  InboxKeys.listnav = { move, extend, open, toggleSelect, selectedRows, clearSelection, archive, trash, toggleStar, markReadUnread, snooze, withSelection, withTemporarySelection, reset, focusTop, focusBottom, syncEdgeAfterScroll, page };
})();
