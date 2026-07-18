// Message navigation INSIDE an open conversation.
//
// A conversation is a stack of message cards ([role="listitem"], each with a
// .gE header). Gmail collapses all but the latest (and stacks the middle ones).
// We keep a cursor over visible cards and explicit expansion controls. Moving
// the cursor never expands/collapses anything. Enter opens a collapsed focused
// message first, then replies once that message is expanded. "o" always toggles
// the focused card or expansion control. All driven by real clicks — Gmail
// ignores synthetic keys.
window.InboxKeys = window.InboxKeys || {};

(function () {
  const { gmail } = InboxKeys;
  const CURSOR_CLASS = "inboxkeys-msg-cursor";
  let cursorEl = null;

  function mainEl() {
    return gmail.firstVisible(gmail.SEL.main);
  }

  function cards() {
    const main = mainEl();
    if (!main) return [];
    return Array.from(main.querySelectorAll(gmail.SEL.card)).filter(
      (it) => gmail.isVisible(it) && it.querySelector(gmail.SEL.cardHeader)
    );
  }

  function isExpansionControl(el) {
    if (!el || !gmail.isVisible(el)) return false;
    const labels = [
      el.getAttribute("aria-label"),
      el.getAttribute("data-tooltip"),
      el.getAttribute("title"),
      el.textContent,
    ].filter(Boolean).map((text) => text.trim().toLowerCase());
    if (labels.some((text) => /^(expand all|collapse all)$/.test(text))) return false;
    const label = labels.join(" ");
    if (el.getAttribute("aria-expanded") === "false") return true;
    if (/\b(expand|show more|show trimmed|show quoted|more messages|view entire)\b/.test(label)) return true;
    return el.classList && (el.classList.contains("ajR") || el.classList.contains("ajT"));
  }

  function expansionControls() {
    const main = mainEl();
    if (!main) return [];
    const candidates = Array.from(main.querySelectorAll(
      'button, [role="button"], [aria-expanded], .ajR, .ajT'
    ));
    return candidates.filter(isExpansionControl);
  }

  function orderedUnique(elements) {
    const seen = new Set();
    return elements
      .filter((el) => {
        if (!el || seen.has(el)) return false;
        seen.add(el);
        return true;
      })
      .sort((a, b) => {
        if (a === b) return 0;
        return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
  }

  function isBefore(a, b) {
    return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  }

  // Arrow stops are the message cards, plus controls that stand for HIDDEN
  // messages — the collapsed "N older messages" stack that sits BETWEEN cards
  // (skipping it would strand those messages from the keyboard). Controls
  // INSIDE a card — Gmail's "Show trimmed content" ⋯ dots, quoted-text
  // expanders — belong to the message the cursor is already on, so arrows must
  // NOT stop on them: every dotted message used to cost an extra keypress (the
  // reported "arrows get stuck on the three dots"). Those stay clickable and
  // the card itself remains the keyboard stop.
  function arrowTargets() {
    const c = cards();
    const between = expansionControls().filter((el) => !c.some((card) => card.contains(el)));
    return orderedUnique([...c, ...between]);
  }

  function isExpandedCard(card) {
    return !!(
      card &&
      Array.from(card.querySelectorAll(".a3s, [data-message-id]")).some((el) => gmail.isVisible(el))
    );
  }

  // Start the cursor on the latest message (the one Gmail expands), so arrow-up
  // walks back through the conversation.
  function ensureCursor(list) {
    const c = list || cards();
    let idx = cursorEl ? c.indexOf(cursorEl) : -1;
    if (idx >= 0) return idx;
    const messageCards = cards();
    cursorEl = messageCards.length ? messageCards[messageCards.length - 1] : (c[c.length - 1] || null);
    idx = cursorEl ? c.indexOf(cursorEl) : -1;
    if (idx < 0 && c.length) {
      cursorEl = c[c.length - 1];
      idx = c.length - 1;
    }
    return idx;
  }

  function paint(list) {
    const main = mainEl();
    if (main) {
      Array.from(main.querySelectorAll("." + CURSOR_CLASS)).forEach((el) => el.classList.remove(CURSOR_CLASS));
    }
    const c = list || arrowTargets();
    ensureCursor(c);
    if (cursorEl) {
      cursorEl.classList.add(CURSOR_CLASS);
      cursorEl.scrollIntoView({ block: "nearest" });
    }
  }

  function currentCard() {
    const c = cards();
    if (!c.length) return null;
    const idx = ensureCursor(c);
    return c[idx] || null;
  }

  // Controls that stand for HIDDEN messages — the collapsed "N older messages"
  // stack BETWEEN cards. Forward consults this: a hidden message may carry
  // attachments no DOM probe can see, so its presence makes the forward target
  // ambiguous.
  function hiddenMessageControls() {
    const c = cards();
    return expansionControls().filter((el) => !c.some((card) => card.contains(el)));
  }

  // Move the cursor one card in `dir` and paint the indicator. Returns true if it
  // actually moved; false when there's nowhere to go (a single card, or already at
  // the first/last) so the caller can fall back to scrolling the reading pane.
  function move(dir) {
    const c = cards();
    if (!c.length) return false;
    let prev = cursorEl ? c.indexOf(cursorEl) : -1;
    if (prev < 0 && cursorEl) {
      const nextCard = dir > 0
        ? c.find((card) => isBefore(cursorEl, card))
        : c.slice().reverse().find((card) => isBefore(card, cursorEl));
      if (nextCard) {
        cursorEl = nextCard;
        paint(c);
        return true;
      }
    }
    prev = ensureCursor(c);
    const next = Math.max(0, Math.min(prev + dir, c.length - 1));
    if (next === prev) return false;
    cursorEl = c[next];
    paint(c);
    return true;
  }

  // Arrows can stop on explicit expansion opportunities in addition to messages.
  function moveArrow(dir) {
    const c = arrowTargets();
    if (!c.length) return false;
    const prev = ensureCursor(c);
    const next = Math.max(0, Math.min(prev + dir, c.length - 1));
    if (next === prev) return false;
    cursorEl = c[next];
    paint(c);
    return true;
  }

  // "o" activates the focused target. Expansion controls are clicked. Message
  // cards are expanded/collapsed through their header.
  function toggleFocused() {
    const c = arrowTargets();
    if (!c.length) return;
    const idx = ensureCursor(c);
    const target = c[idx];
    if (!target) return;
    if (target.matches('[role="listitem"]')) {
      const header = target.querySelector(".gE");
      if (header) gmail.realClick(header);
    } else {
      gmail.realClick(target);
    }
    // The card heights shift; re-pin the cursor highlight after Gmail re-lays out.
    setTimeout(() => paint(), 120);
  }

  function replyAllFocused() {
    const card = currentCard();
    return gmail.replyAllToThread(card || document);
  }

  function activateFocused() {
    const c = arrowTargets();
    if (!c.length) return false;
    const idx = ensureCursor(c);
    const target = c[idx];
    if (!target) return false;
    if (!target.matches('[role="listitem"]')) {
      gmail.realClick(target);
      setTimeout(() => paint(), 120);
      return true;
    }
    if (isExpandedCard(target)) return gmail.replyAllToThread(target);
    const header = target.querySelector(".gE");
    if (!header) return false;
    gmail.realClick(header);
    setTimeout(() => paint(), 120);
    return true;
  }

  function toggle() {
    toggleFocused();
  }

  // Expand all (or collapse all if already expanded) — the conversation's
  // top-right toggle.
  function expandAllToggle() {
    const btn = gmail.exactButton("Expand all") || gmail.exactButton("Collapse all");
    if (btn) gmail.realClick(btn);
    setTimeout(() => paint(), 150);
  }

  function reset() {
    cursorEl = null;
  }

  window.addEventListener("hashchange", reset);

  InboxKeys.threadnav = { move, moveArrow, toggleFocused, replyAllFocused, activateFocused, toggle, expandAllToggle, currentCard, hiddenMessageControls, reset };
})();
