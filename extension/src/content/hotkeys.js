// Keyboard engine: palette toggle (Cmd/Ctrl+K) plus single-key and chord
// shortcuts (e.g. "g i") mapped to commands. Shortcuts are gated by the current
// Gmail context (gmail.getContext()) so a binding only fires where it makes
// sense, and only fire when their .contexts include the current context (or "*").
//
// When we claim a key we consume() it (preventDefault + stopImmediatePropagation
// in the capture phase) so Gmail never double-handles it. Synthetic keys that we
// dispatch via gmail.sendKey are tagged and ignored on re-entry, killing the
// recursion / double-fire loop.
window.OpenSuperhuman = window.OpenSuperhuman || {};

(function () {
  const { commands, palette, storage, gmail, calendar, listnav, threadnav } = OpenSuperhuman;

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
      el.getAttribute("contenteditable") === "true" ||
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

  function hasListSelection() {
    return !!(listnav && listnav.selectedRows && listnav.selectedRows().length);
  }

  function hasVisibleListSurface() {
    return Array.from(
      document.querySelectorAll('tr.zA, [role="main"] [gh="tl"], [role="main"] [role="checkbox"]')
    ).some((el) => gmail.isVisible && gmail.isVisible(el));
  }

  function canOverrideEditable(e, ctx) {
    if (!isSearchInput(e.target)) return false;
    if (!isSubmittedSearchView()) return false;
    if (ctx !== "threadView" && ctx !== "inboxList") return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    // searchEditing means the user is composing a query, so letters should type.
    // But once rows are selected they're triaging, not typing — let triage keys
    // (x to deselect, e to archive, Escape to clear) through even with the search
    // box focused. Otherwise the selection is stuck: "I selected it but can't clear."
    if (searchEditing && !hasListSelection()) return false;

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

  function keyToken(e) {
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
      } else if (/[a-zA-Z]/.test(k)) {
        k = k.toLowerCase();
      }
      return mods.length ? mods.join("+") + "+" + k : k;
    }
    return k;
  }

  function keyAliases(token) {
    const aliases = [token];
    if (token.startsWith("Ctrl+")) aliases.push("Mod+" + token.slice(5));
    return aliases;
  }

  function commandHasKey(id, binding) {
    if (!window.OpenSuperhuman_KEYMAP || typeof OpenSuperhuman_KEYMAP.keysFor !== "function") return true;
    return OpenSuperhuman_KEYMAP.keysFor(id, storage.get("keyOverrides") || {}).includes(binding);
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
    const token = keyToken(e);
    const tokens = keyAliases(token);

    // "g" + digit -> jump straight to that signed-in account (/mail/u/N).
    // First-class so every account 0–8 is reachable even before we've learned
    // its email, rather than only the indices the palette happens to list.
    if (chordPrefix === "g" && /^[0-8]$/.test(key)) {
      clearChord();
      consume(e);
      OpenSuperhuman.accounts.switchTo(parseInt(key, 10));
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
    const startsChord = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && inCtx.some((m) => m.keys.startsWith(key + " "));
    const single = inCtx.find((m) => tokens.includes(m.keys));

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
    if (e.__openSuperhumanSynthetic || (gmail.isDispatchingSynthetic && gmail.isDispatchingSynthetic())) return;

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
      } else if (e.key === "Escape" && searchEditing && !hasListSelection()) {
        // Only blur the search box on Escape when there's nothing selected. With a
        // standing selection, let Escape fall through to clear it first.
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

    // Escape from Gmail's attachment preview should close the preview first. Gmail
    // exposes that preview as a dialog, so it otherwise looks like a generic modal
    // and would block the normal thread Escape path.
    if (e.key === "Escape" && (ctx === "attachmentPreview" || (gmail.hasAttachmentPreview && gmail.hasAttachmentPreview()))) {
      if (gmail.closeAttachmentPreview && gmail.closeAttachmentPreview()) consume(e);
      return;
    }

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

    const composeBody = gmail.composeBody && gmail.composeBody();
    const inComposeBody = composeBody && e.target && (e.target === composeBody || composeBody.contains(e.target));
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "u" && (ctx === "compose" || inComposeBody)) {
      consume(e);
      gmail.attachFile();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "d" && (ctx === "compose" || inComposeBody)) {
      consume(e);
      gmail.discardDraft();
      return;
    }

    // Tab / Shift+Tab: cycle split-inbox tabs from any top-level Gmail list
    // surface. Gmail can leave focus in the search input, or briefly report an
    // otherwise unknown context while the list is visible; split-tab navigation
    // should still work there. Keep compose/thread/modal/editable fields protected.
    if (
      e.key === "Tab" &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !gmail.inThread() &&
      (ctx === "inboxList" || ctx === "unknown" || (ctx === "searchFocused" && hasVisibleListSurface())) &&
      (!isEditable(e.target) || isSearchInput(e.target))
    ) {
      consume(e);
      searchEditing = false;
      if (e.shiftKey) OpenSuperhuman.tabs.prev();
      else OpenSuperhuman.tabs.next();
      return;
    }

    // Shift+N / Shift+P: page the message list forward (older) / back (newer) via
    // Gmail's own "Older"/"Newer" pager. Like Tab, this must work on any list
    // surface, including search results where Gmail keeps the search box focused,
    // so it sits before the editable guard. Protected from compose/thread/modal
    // and from editable fields other than the search box.
    if (
      e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      (e.key === "N" || e.key === "n" || e.key === "P" || e.key === "p") &&
      !gmail.inThread() &&
      (ctx === "inboxList" || ctx === "unknown" || ctx === "searchFocused") &&
      hasVisibleListSurface() &&
      (!isEditable(e.target) || isSearchInput(e.target))
    ) {
      consume(e);
      searchEditing = false;
      if (e.key === "N" || e.key === "n") OpenSuperhuman.listnav.page(1);
      else OpenSuperhuman.listnav.page(-1);
      return;
    }

    // Modified Superhuman bindings. Keep compose/editable fields protected so
    // Gmail/browser formatting shortcuts still work while writing.
    if (!isEditable(e.target) && !e.altKey && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
      const modKey = e.key.toLowerCase();
      if (modKey === "u" && ctx === "threadView") {
        consume(e);
        gmail.unsubscribe();
        return;
      }
      if (modKey === "o" && ctx === "threadView") {
        consume(e);
        gmail.openLinkOrAttachment(threadnav.currentCard ? threadnav.currentCard() : document);
        return;
      }
    }

    // Below here we never fire while typing. Modifier chords are allowed for
    // user-configured shortcuts as long as focus is outside editable fields.
    if (isEditable(e.target) && !canOverrideEditable(e, ctx)) return;
    const hasNonShiftModifier = e.metaKey || e.ctrlKey || e.altKey;

    // Thread view: j/k move between conversations. Arrows move the visible cursor
    // through message cards plus explicit expansion controls inside the current
    // thread; when there is nowhere else to move, arrows scroll the reading pane.
    // Enter opens a collapsed focused message, then reply-alls once expanded.
    // "o" always toggles the focused message/control.
    if (ctx === "threadView" && !hasNonShiftModifier) {
      if (e.key === "j") { consume(e); gmail.nextThread(); return; }
      if (e.key === "k") { consume(e); gmail.prevThread(); return; }
      if (e.key === "ArrowDown") { consume(e); if (!threadnav.moveArrow(1)) gmail.threadScrollBy(1); return; }
      if (e.key === "ArrowUp") { consume(e); if (!threadnav.moveArrow(-1)) gmail.threadScrollBy(-1); return; }
      if (e.key === "PageDown") { consume(e); gmail.threadScrollBy(1, 0.9); return; }
      if (e.key === "PageUp") { consume(e); gmail.threadScrollBy(-1, 0.9); return; }
      if (e.key === "Enter") { consume(e); threadnav.activateFocused(); return; }
      if (e.key.toLowerCase() === "o" && e.shiftKey) { consume(e); threadnav.expandAllToggle(); return; }
      if (e.key.toLowerCase() === "o" && commandHasKey("expand-message", "o")) { consume(e); threadnav.toggleFocused(); return; }
      if (e.key === ":" || e.key === ";") { consume(e); threadnav.expandAllToggle(); return; }
      if (e.key.toLowerCase() === "e" && !e.shiftKey && commandHasKey("archive", "e")) { consume(e); gmail.archiveThread(); return; }
      if (e.key.toLowerCase() === "r" && !e.shiftKey && commandHasKey("reply", "r")) { consume(e); gmail.replyToThread(); return; }
    }

    // Shift+G -> bottom of the list. Special-cased BEFORE chord logic, otherwise
    // our lowercasing matcher misreads it as the start of a "g …" chord. (Other
    // shifted keys like "#"/"!" lowercase to themselves and flow into the matcher
    // below normally.)
    if (
      e.shiftKey &&
      e.key.toLowerCase() === "g" &&
      !hasNonShiftModifier &&
      !chordPrefix &&
      ctx === "inboxList"
    ) {
      consume(e);
      gmail.listScrollBottom();
      if (listnav.syncEdgeAfterScroll) listnav.syncEdgeAfterScroll(1);
      return;
    }

    if (e.shiftKey && !hasNonShiftModifier && e.key.toLowerCase() === "e" && (ctx === "inboxList" || ctx === "threadView")) {
      consume(e);
      if (ctx === "inboxList" && listnav.withSelection) listnav.withSelection(() => gmail.markNotDone());
      else gmail.markNotDone();
      return;
    }

    if (e.shiftKey && !hasNonShiftModifier && e.key.toLowerCase() === "m" && (ctx === "inboxList" || ctx === "threadView")) {
      consume(e);
      if (ctx === "inboxList" && listnav.withSelection) listnav.withSelection(() => gmail.mute());
      else gmail.mute();
      return;
    }

    if (e.shiftKey && !hasNonShiftModifier && e.key.toLowerCase() === "y" && (ctx === "inboxList" || ctx === "threadView")) {
      consume(e);
      if (ctx === "inboxList" && listnav.withSelection) listnav.withSelection(() => gmail.removeAllLabels());
      else gmail.removeAllLabels();
      return;
    }

    // Calendar "0" / "00" — top level only (inbox list / unknown, not inside a
    // thread), not mid-chord (so "g 0" account-switch still works), not editable.
    if (
      !chordPrefix &&
      !hasNonShiftModifier &&
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
    if (ctx === "inboxList" && !hasNonShiftModifier) {
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
      if (e.key.toLowerCase() === "e" && !e.shiftKey && commandHasKey("archive", "e")) { consume(e); listnav.archive(); return; }
    }

    runChordOrKey(e, ctx);
  }

  function install() {
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("pointerdown", (e) => {
      if (isSearchInput(e.target)) searchEditing = true;
    }, true);
    // A hashchange means a search was submitted (or we navigated): typing a query
    // never changes the hash, so we are no longer composing. Clear searchEditing so
    // it can't get stuck true and swallow the list shortcuts (e/x/j/k) while Gmail
    // keeps the search box focused over the results. Previously searchEditing only
    // cleared on Enter/Escape in the box or a blur timeout, so submitting via a
    // suggestion click or re-focusing the box left it stuck — "e stops archiving
    // after a search". canOverrideEditable then refused every list key.
    window.addEventListener("hashchange", () => { searchEditing = false; });
  }

  function armSearchEditing() {
    searchEditing = true;
  }

  OpenSuperhuman.hotkeys = { install, armSearchEditing };
})();
