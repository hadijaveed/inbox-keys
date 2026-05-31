// Message navigation INSIDE an open conversation.
//
// A conversation is a stack of message cards ([role="listitem"], each with a
// .gE header). Gmail collapses all but the latest (and stacks the middle ones).
// We keep a cursor over the visible cards. Arrows / j / k move it and expand
// the focused card, while ":" expands/collapses the whole thread. All driven by
// real clicks — Gmail ignores synthetic keys.
window.CMDK = window.CMDK || {};

(function () {
  const { gmail } = CMDK;
  const CURSOR_CLASS = "cmdk-msg-cursor";
  let cursor = -1;

  function cards() {
    const main = document.querySelector('[role="main"]');
    if (!main) return [];
    return Array.from(main.querySelectorAll('[role="listitem"]')).filter(
      (it) => gmail.isVisible(it) && it.querySelector(".gE")
    );
  }

  // Start the cursor on the latest message (the one Gmail expands), so arrow-up
  // walks back through the conversation.
  function ensureCursor(list) {
    const c = list || cards();
    if (cursor >= 0 && cursor < c.length) return cursor;
    cursor = c.length ? c.length - 1 : -1;
    return cursor;
  }

  function paint(list) {
    const c = list || cards();
    c.forEach((it, i) => it.classList.toggle(CURSOR_CLASS, i === cursor));
    const el = c[cursor];
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function currentCard() {
    const c = cards();
    if (!c.length) return null;
    ensureCursor(c);
    return c[cursor] || null;
  }

  function move(dir) {
    const c = cards();
    if (!c.length) return;
    ensureCursor(c);
    cursor = Math.max(0, Math.min(cursor + dir, c.length - 1));
    paint(c);
    expandFocused(c);
  }

  function isExpanded(card) {
    return !!(
      card &&
      Array.from(card.querySelectorAll(".a3s, [data-message-id]")).some((el) => gmail.isVisible(el))
    );
  }

  // Expand the focused message if Gmail currently has it collapsed.
  function expandFocused(list) {
    const c = list || cards();
    if (!c.length) return;
    ensureCursor(c);
    const card = c[cursor];
    if (!card || isExpanded(card)) return;
    const header = card.querySelector(".gE");
    if (header) gmail.realClick(header);
    setTimeout(() => paint(), 120);
  }

  // Expand / collapse the focused message (click its header).
  function toggle() {
    const c = cards();
    if (!c.length) return;
    ensureCursor(c);
    const header = c[cursor] && c[cursor].querySelector(".gE");
    if (header) gmail.realClick(header);
    // The card heights shift; re-pin the cursor highlight after Gmail re-lays out.
    setTimeout(() => paint(), 120);
  }

  // Expand all (or collapse all if already expanded) — the conversation's
  // top-right toggle.
  function expandAllToggle() {
    const btn = gmail.exactButton("Expand all") || gmail.exactButton("Collapse all");
    if (btn) gmail.realClick(btn);
    setTimeout(() => paint(), 150);
  }

  function reset() {
    cursor = -1;
  }

  window.addEventListener("hashchange", reset);

  CMDK.threadnav = { move, toggle, expandAllToggle, currentCard, reset };
})();
