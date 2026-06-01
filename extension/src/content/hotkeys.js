// Keyboard engine: palette toggle (Cmd/Ctrl+K) plus single-key and chord
// shortcuts (e.g. "g i") mapped to commands. Shortcuts are gated by the current
// Gmail context (gmail.getContext()) so a binding only fires where it makes
// sense, and only fire when their .contexts include the current context (or "*").
//
// When we claim a key we consume() it (preventDefault + stopImmediatePropagation
// in the capture phase) so Gmail never double-handles it. Synthetic keys that we
// dispatch via gmail.sendKey are tagged and ignored on re-entry, killing the
// recursion / double-fire loop.
window.CMDK = window.CMDK || {};

(function () {
  const { commands, palette, storage, gmail, calendar, listnav, threadnav } = CMDK;

  let chordPrefix = null;
  let chordTimer = null;
  let zeroTimer = null;
  let searchEditing = false;

  function isEditable(el) {
    // A keydown target can be the document/window (no Element methods), e.g. when
    // focus sits on nothing — guard before touching getAttribute/tagName.
    if (!el || typeof el.getAttribute !== "function") return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable ||
      el.getAttribute("role") === "textbox"
    );
  }

  function isSearchInput(el) {
    return !!(
      el &&
      el.matches &&
      el.matches('input[aria-label="Search mail"], input[name="q"]')
    );
  }

  function isSubmittedSearchView() {
    return /^#search\//.test(location.hash || "");
  }

  function canOverrideEditable(e, ctx) {
    if (!isSearchInput(e.target)) return false;
    if (!isSubmittedSearchView()) return false;
    if (ctx !== "threadView" && ctx !== "inboxList") return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (searchEditing) return false;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    return [
      "ArrowDown",
      "ArrowUp",
      "Enter",
      "Escape",
      "Tab",
      "j",
      "k",
      "e",
      "x",
      ":",
      ";",
    ].includes(key);
  }

  function blurSubmittedSearch(box) {
    if (!box) return;
    for (const delay of [120, 500]) {
      setTimeout(() => {
        if (document.activeElement === box && isSubmittedSearchView()) {
          searchEditing = false;
          box.blur();
        }
      }, delay);
    }
  }

  // Claim a key for ourselves: stop default and any further handlers (Gmail's
  // own capture-phase listeners included) from seeing it.
  function consume(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // A binding applies in the current context if its .contexts list includes the
  // context (or "*"). Missing/empty contexts are treated as universal so older
  // catalog state keeps working.
  function appliesIn(entry, ctx) {
    const c = entry && entry.contexts;
    if (!c || !c.length) return true;
    return c.indexOf(ctx) !== -1 || c.indexOf("*") !== -1;
  }

  function matchesModK(e) {
    const binding = storage.get("paletteHotkey") || "mod+k";
    const wantMod = binding.includes("mod");
    const key = binding.split("+").pop();
    const mod = e.metaKey || e.ctrlKey;
    return e.key.toLowerCase() === key && (!wantMod || mod);
  }

  function clearChord() {
    chordPrefix = null;
    if (chordTimer) clearTimeout(chordTimer);
    chordTimer = null;
  }

  // Calendar key: "0" toggles Gmail's side calendar panel; a quick "0 0" opens
  // calendar in a new tab. Top-level views only (handled by the caller).
  function handleZero() {
    if (zeroTimer) {
      clearTimeout(zeroTimer);
      zeroTimer = null;
      calendar.open("tab");
      return;
    }
    zeroTimer = setTimeout(() => {
      zeroTimer = null;
      calendar.open("side");
    }, 280);
  }

  // Run a chord continuation or a single binding, gated by context. Returns true
  // if the key was claimed.
  function runChordOrKey(e, ctx) {
    const map = commands.byKeys();
    const key = e.key.toLowerCase();

    // "g" + digit -> jump straight to that signed-in account (/mail/u/N).
    // First-class so every account 0–8 is reachable even before we've learned
    // its email, rather than only the indices the palette happens to list.
    if (chordPrefix === "g" && /^[0-8]$/.test(key)) {
      clearChord();
      consume(e);
      CMDK.accounts.switchTo(parseInt(key, 10));
      return true;
    }

    // Continuing a chord like "g i" / "g g".
    if (chordPrefix) {
      const combo = `${chordPrefix} ${key}`;
      const hit = map.find((m) => m.keys === combo && appliesIn(m, ctx));
      clearChord();
      if (hit) {
        consume(e);
        hit.cmd.run();
        return true;
      }
      // fall through: maybe the second key is itself a single binding
    }

    const inCtx = map.filter((m) => appliesIn(m, ctx));

    // Is this key the start of any (in-context) chord?
    const startsChord = inCtx.some((m) => m.keys.startsWith(key + " "));
    const single = inCtx.find((m) => m.keys === key);

    if (startsChord && !single) {
      chordPrefix = key;
      chordTimer = setTimeout(clearChord, 900);
      consume(e);
      return true;
    }
    if (single) {
      consume(e);
      single.cmd.run();
      return true;
    }
    return false;
  }

  function onKeydown(e) {
    if (!storage.get("enabled")) return;

    // Ignore the synthetic events we dispatch via gmail.sendKey (capture phase
    // re-entry) so native fallbacks don't recurse back into us.
    if (e.__cmdkSynthetic || (gmail.isDispatchingSynthetic && gmail.isDispatchingSynthetic())) return;

    // Palette toggle works everywhere (even while typing).
    if (matchesModK(e)) {
      consume(e);
      palette.toggle();
      return;
    }

    // Compute context once for this keydown.
    const ctx = gmail.getContext();

    if (isSearchInput(e.target)) {
      if (e.key === "Enter" && searchEditing) {
        searchEditing = false;
        blurSubmittedSearch(e.target);
        return;
      } else if (e.key === "Escape" && searchEditing) {
        searchEditing = false;
        e.target.blur();
        return;
      }
    }

    // Palette open: drive navigation from here (capture phase) so it works even
    // if the input loses focus — the old "type into the input only" approach got
    // stuck the moment focus drifted. Typing keys fall through to the input.
    if (palette.isOpen()) {
      if (e.key === "ArrowDown") { consume(e); palette.move(1); return; }
      if (e.key === "ArrowUp") { consume(e); palette.move(-1); return; }
      if (e.key === "Enter") { consume(e); palette.confirm(); return; }
      if (e.key === "Tab") { consume(e); palette.move(e.shiftKey ? -1 : 1); return; }
      if (e.key === "Escape") { consume(e); palette.hide(); return; }
      return;
    }
    if (!storage.get("hotkeysEnabled")) return;

    // Escape inside an open reply: cancel/leave reply mode first. Only a later
    // Escape from normal thread reading should go back to the list.
    if (e.key === "Escape" && gmail.hasOpenThreadReply && gmail.hasOpenThreadReply()) {
      if (gmail.exitReply()) consume(e);
      return;
    }

    // Escape: in a thread (palette closed) go back to the list.
    if (e.key === "Escape" && ctx === "threadView") {
      consume(e);
      gmail.back();
      return;
    }

    // Below here we never fire while typing or with modifier chords (except the
    // Shift cases we special-case explicitly).
    if (isEditable(e.target) && !canOverrideEditable(e, ctx)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Thread view: j/k move between message cards. Arrows move the same visible
    // cursor through message cards plus explicit expansion controls; when there is
    // nowhere else to move, arrows scroll the reading pane. Enter activates the
    // focused message/control, so navigation itself never expands the thread.
    if (ctx === "threadView") {
      if (e.key === "j") { consume(e); threadnav.move(1); return; }
      if (e.key === "k") { consume(e); threadnav.move(-1); return; }
      if (e.key === "ArrowDown") { consume(e); if (!threadnav.moveArrow(1)) gmail.threadScrollBy(1); return; }
      if (e.key === "ArrowUp") { consume(e); if (!threadnav.moveArrow(-1)) gmail.threadScrollBy(-1); return; }
      if (e.key === "PageDown") { consume(e); gmail.threadScrollBy(1, 0.9); return; }
      if (e.key === "PageUp") { consume(e); gmail.threadScrollBy(-1, 0.9); return; }
      if (e.key === "Enter") { consume(e); threadnav.activate(); return; }
      if (e.key === ":" || e.key === ";") { consume(e); threadnav.expandAllToggle(); return; }
      if (e.key.toLowerCase() === "e" && !e.shiftKey) { consume(e); gmail.archiveThread(); return; }
      if (e.key.toLowerCase() === "r" && !e.shiftKey) { consume(e); gmail.replyToThread(); return; }
    }

    // Tab / Shift+Tab: cycle split-inbox tabs — only on the inbox list, never in
    // compose / thread / search / editable.
    if (e.key === "Tab" && ctx === "inboxList") {
      consume(e);
      if (e.shiftKey) CMDK.tabs.prev();
      else CMDK.tabs.next();
      return;
    }

    // Shift+G -> bottom of the list. Special-cased BEFORE chord logic, otherwise
    // our lowercasing matcher misreads it as the start of a "g …" chord. (Other
    // shifted keys like "#"/"!" lowercase to themselves and flow into the matcher
    // below normally.)
    if (
      e.shiftKey &&
      e.key.toLowerCase() === "g" &&
      !chordPrefix &&
      ctx === "inboxList"
    ) {
      consume(e);
      gmail.listScrollBottom();
      return;
    }

    // Calendar "0" / "00" — top level only (inbox list / unknown, not inside a
    // thread), not mid-chord (so "g 0" account-switch still works), not editable.
    if (
      !chordPrefix &&
      e.key === "0" &&
      storage.get("calendarEnabled") !== false &&
      (ctx === "inboxList" || ctx === "unknown") &&
      !gmail.inThread()
    ) {
      consume(e);
      handleZero();
      return;
    }

    // Inbox list: arrow / j / k move our keyboard cursor; Shift+Arrow grows a
    // selection; Enter opens the cursor thread; x toggles its checkbox; e archives
    // (the selected set, or the cursor row).
    if (ctx === "inboxList") {
      if (e.key === "Escape") {
        // End a multi-select without clicking away; otherwise let Gmail have it.
        if (listnav.selectedRows().length) { consume(e); listnav.clearSelection(); return; }
        return;
      }
      if (e.key === "ArrowDown") { consume(e); e.shiftKey ? listnav.extend(1) : listnav.move(1); return; }
      if (e.key === "ArrowUp") { consume(e); e.shiftKey ? listnav.extend(-1) : listnav.move(-1); return; }
      if (e.key === "j") { consume(e); listnav.move(1); return; }
      if (e.key === "k") { consume(e); listnav.move(-1); return; }
      if (e.key === "Enter") { consume(e); listnav.open(); return; }
      if (e.key === "x") { consume(e); listnav.toggleSelect(); return; }
      if (e.key.toLowerCase() === "e" && !e.shiftKey) { consume(e); listnav.archive(); return; }
    }

    runChordOrKey(e, ctx);
  }

  function install() {
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("pointerdown", (e) => {
      if (isSearchInput(e.target)) searchEditing = true;
    }, true);
  }

  function armSearchEditing() {
    searchEditing = true;
  }

  CMDK.hotkeys = { install, armSearchEditing };
})();
