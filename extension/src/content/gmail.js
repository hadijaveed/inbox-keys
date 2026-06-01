// Helpers for driving the Gmail UI from the content script.
//
// Strategy, in order of robustness:
//   1) Hash routing (#inbox, #sent, #search/...) — very stable, Gmail's own router.
//   2) Stable Gmail attributes ([gh="cm"] = compose, [gh="tm"] = toolbar).
//   3) Toolbar buttons matched by data-tooltip / aria-label (English; localizable later).
//   4) Native Gmail keyboard shortcuts as a fallback (requires shortcuts ON in Gmail).
window.CMDK = window.CMDK || {};

(function () {
  function accountIndex() {
    const m = location.pathname.match(/\/mail\/u\/(\d+)\//);
    return m ? parseInt(m[1], 10) : 0;
  }

  function basePath() {
    return `/mail/u/${accountIndex()}/`;
  }

  function setHash(hash) {
    location.hash = hash.startsWith("#") ? hash : "#" + hash;
  }

  // True when a single conversation is open (hash ends in a long thread id),
  // e.g. #inbox/FMfcgz... or #search/is:unread/FMfcgz... The id is the LAST hash
  // segment regardless of how many list/query/label segments precede it — see
  // CMDK.hashutil.hashIsThread. (Earlier this assumed the id was the 2nd segment,
  // which broke threads opened from search: shortcuts died until you cleared the
  // search box.)
  function inThread() {
    return CMDK.hashutil.hashIsThread(location.hash || "");
  }

  // Visible-only query helper.
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Gmail's controls (row buttons, side-rail tabs, toolbar icons) frequently
  // ignore a bare element.click(); they only react to a full pointer + mouse
  // gesture at the element's center. realClick synthesizes the whole sequence.
  // (Trusted-vs-untrusted doesn't matter here — these are DOM click handlers,
  // not Gmail's native keyboard router, which DOES reject synthetic keys.)
  function realClick(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    for (const type of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ctor = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, opts));
    }
    return true;
  }

  function findByTooltip(prefix) {
    const sel = [
      `[data-tooltip^="${prefix}"]`,
      `[aria-label^="${prefix}"]`,
      `[data-tooltip*="${prefix}"]`,
    ].join(",");
    return Array.from(document.querySelectorAll(sel)).filter(isVisible);
  }

  function clickByTooltip(prefix) {
    const el = findByTooltip(prefix)[0];
    if (!el) return false;
    return realClick(el);
  }

  // First visible element whose aria-label / data-tooltip equals `label` exactly.
  function exactButton(label, scope = document) {
    return (
      Array.from(
        scope.querySelectorAll(`[aria-label="${label}"], [data-tooltip="${label}"]`)
      ).filter(isVisible)[0] || null
    );
  }

  function buttonLabel(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("data-tooltip") ||
      el.getAttribute("title") ||
      (el.textContent || "")
    ).trim();
  }

  function labeledButton(patterns, scope = document) {
    const list = Array.from(
      scope.querySelectorAll('[aria-label], [data-tooltip], [title], [role="button"], [role="menuitem"], .T-I, .ams')
    ).filter(isVisible);
    return (
      list.find((el) => {
        const label = buttonLabel(el);
        return patterns.some((p) => p.test(label));
      }) || null
    );
  }

  function compose() {
    const btn = document.querySelector('[gh="cm"], [role="button"][gh="cm"]');
    if (btn && isVisible(btn)) {
      btn.click();
      return true;
    }
    // Fallback: Gmail compose deep-link.
    location.href = `${basePath()}#inbox?compose=new`;
    return true;
  }

  // Dispatch a native single-key Gmail shortcut (e.g. 'c', 'e', 'r').
  // Requires "Keyboard shortcuts on" in Gmail settings.
  // Events are tagged __cmdkSynthetic=true so the capture-phase hotkey engine
  // can ignore them on re-entry (kills recursion / double-fire).
  let _dispatchingSynthetic = false;
  function sendKey(key, opts = {}) {
    // Hard recursion breaker: a synthetic key must never trigger another
    // synthetic key synchronously. Without this entry guard a re-entrant call
    // recurses until "Maximum call stack size exceeded".
    if (_dispatchingSynthetic) return;
    const target = document.body;
    const base = {
      key,
      code: keyCode(key),
      keyCode: key.toUpperCase().charCodeAt(0),
      which: key.toUpperCase().charCodeAt(0),
      bubbles: true,
      cancelable: true,
      ...opts,
    };
    _dispatchingSynthetic = true;
    try {
      const down = new KeyboardEvent("keydown", base);
      down.__cmdkSynthetic = true;
      target.dispatchEvent(down);
      const up = new KeyboardEvent("keyup", base);
      up.__cmdkSynthetic = true;
      target.dispatchEvent(up);
    } finally {
      _dispatchingSynthetic = false;
    }
  }

  function isDispatchingSynthetic() {
    return _dispatchingSynthetic;
  }

  function keyCode(key) {
    if (/^[a-z]$/i.test(key)) return "Key" + key.toUpperCase();
    return key;
  }

  // Try a tooltip click first, then fall back to a native shortcut.
  function action(tooltipPrefixes, fallbackKey) {
    for (const p of [].concat(tooltipPrefixes)) {
      if (clickByTooltip(p)) return true;
    }
    if (fallbackKey) {
      sendKey(fallbackKey);
      return true;
    }
    return false;
  }

  // Read the signed-in account email from the top-right account button.
  function currentEmail() {
    const a = document.querySelector('a[aria-label^="Google Account"], a[aria-label*="Google Account:"]');
    if (a) {
      const m = a.getAttribute("aria-label").match(/\(([^)]+@[^)]+)\)/);
      if (m) return m[1];
    }
    const t = document.querySelector('[data-hovercard-id*="@"]');
    if (t) return t.getAttribute("data-hovercard-id");
    return null;
  }

  // The active compose editor body (contenteditable).
  function composeBody() {
    const editors = Array.from(
      document.querySelectorAll('div[aria-label="Message Body"], div[g_editable="true"], [contenteditable="true"][role="textbox"]')
    ).filter(isVisible);
    return editors[editors.length - 1] || null;
  }

  function threadReplyBody() {
    if (!inThread()) return null;
    return composeBody();
  }

  function hasOpenThreadReply() {
    const body = threadReplyBody();
    const active = document.activeElement;
    return !!(body && active && (active === body || body.contains(active)));
  }

  function composeText(body) {
    return String((body && (body.innerText || body.textContent)) || "")
      .replace(/\u200b/g, "")
      .trim();
  }

  function isComposeEmpty(body) {
    const text = composeText(body);
    return !text || /^Press\s+\/\s+to write/i.test(text);
  }

  // The recipient field text for the active compose, best-effort.
  function composeRecipients() {
    const chips = Array.from(
      document.querySelectorAll('[email], input[name="to"], textarea[name="to"]')
    )
      .filter(isVisible)
      .map((el) => el.getAttribute("email") || el.value)
      .filter(Boolean);
    return Array.from(new Set(chips)).join(", ");
  }

  function composeSubject() {
    const s = Array.from(document.querySelectorAll('input[name="subjectbox"]')).filter(isVisible)[0];
    return s ? s.value : "";
  }

  // Go back from an open thread to the list. Click a visible Back button if
  // Gmail renders one; otherwise drive Gmail's own hash router by stripping the
  // thread id off the hash (#inbox/<id> -> #inbox, #search/<q>/<id> -> #search/<q>).
  //
  // We deliberately do NOT fall back to sendKey("u"): Gmail ignores synthetic
  // keyboard events (isTrusted === false) for native navigation, so a fake "u"
  // silently does nothing. Hash routing is trusted and always works.
  function back() {
    const sels = [
      '[aria-label^="Back to"]',
      '[data-tooltip^="Back to"]',
      'div[role="button"][aria-label^="Back"]',
    ];
    for (const sel of sels) {
      const el = Array.from(document.querySelectorAll(sel)).filter(isVisible)[0];
      if (el) {
        el.click();
        return true;
      }
    }
    location.hash = CMDK.hashutil.parentHash(location.hash || "");
    return true;
  }

  // ---- Open-thread actions (thread view) --------------------------------
  // These click real Gmail controls (Gmail ignores synthetic keystrokes, so
  // pressing a fake "r"/"j" does nothing — we drive the buttons instead).

  function amsButton(re, scope = document) {
    return (
      Array.from(scope.querySelectorAll(".ams"))
        .filter(isVisible)
        .find((b) => re.test((b.textContent || "").trim())) || null
    );
  }

  // Start a reply on the open thread: the inline "Reply" link, else the
  // per-message reply arrow icon.
  function replyToThread(scope = document) {
    const opened = realClick(
      amsButton(/^reply$/i, scope) ||
        labeledButton([/^Reply(?!\s+(all|to all))\b/i], scope) ||
        exactButton("Reply", scope)
    );
    if (opened) focusReplyBodySoon();
    return opened;
  }
  // The inline "Reply all" button Gmail renders at the BOTTOM of a multi-recipient
  // conversation (the `.ams` links, or a labeled/exact-labeled button).
  function inlineReplyAll(scope = document) {
    return (
      amsButton(/^reply all\b/i, scope) ||
      labeledButton([/^Reply all\b/i, /^Reply to all\b/i], scope) ||
      exactButton("Reply to all", scope)
    );
  }

  function replyAllToThread(scope = document) {
    // Reply-all clicks Gmail's inline "Reply all" button (verified live: it opens
    // the composer addressed to everyone in ONE click). When the thread is just you
    // and one other person Gmail offers no "Reply all" — a plain reply already goes
    // to that person — so we open that instead.
    //
    // We deliberately NEVER open the response-type caret menu. That menu popped up
    // over the compose box and fought with typing, and on a two-person thread there
    // is nothing to switch to anyway. Look in the focused card first, then fall back
    // to the whole thread: the inline controls live at the bottom of the
    // conversation, outside the message card listitem, so a card-only lookup
    // usually finds nothing (this was the silent-dead-Enter funkiness).
    const replyAll = inlineReplyAll(scope) || (scope !== document && inlineReplyAll(document));
    if (realClick(replyAll)) {
      focusReplyBodySoon();
      return true;
    }

    // No reply-all offered (two-person thread): the single reply IS the reply-all.
    return replyToThread(scope) || (scope !== document && replyToThread(document));
  }

  function focusReplyBodySoon() {
    waitFor(composeBody, (body) => {
      if (typeof body.focus === "function") body.focus();
      realClick(body);
    }, null, 10, 60);
  }

  // Poll for an element Gmail renders lazily; run onFound when it appears, else
  // onGiveUp after the budget. The FIRST probe is synchronous, so when the DOM is
  // already in place the whole chain completes without timers (deterministic in
  // tests; resilient to slow renders in the wild).
  function waitFor(find, onFound, onGiveUp, tries = 16, interval = 80) {
    const el = find();
    if (el) return onFound(el);
    if (tries <= 0) return onGiveUp && onGiveUp();
    setTimeout(() => waitFor(find, onFound, onGiveUp, tries - 1, interval), interval);
  }

  function forwardThread() {
    return realClick(
      amsButton(/^forward\b/i) ||
        labeledButton([/^Forward\b/i]) ||
        exactButton("Forward")
    );
  }

  // Older = next (further down the list), Newer = previous.
  function nextThread() {
    return realClick(exactButton("Older"));
  }
  function prevThread() {
    return realClick(exactButton("Newer"));
  }

  // Archive the open thread via its toolbar icon (returns to the list).
  function archiveThread() {
    return realClick(exactButton("Archive"));
  }

  // Leave an open inline reply before Escape is allowed to navigate back from the
  // thread. Empty replies are discarded; non-empty replies are only blurred/saved.
  function exitReply() {
    const body = threadReplyBody();
    const surface = composeSurface(body);
    if (body && isComposeEmpty(body)) {
      const discard =
        labeledButton([/^Discard draft/i, /^Discard$/i], surface || document) ||
        labeledButton([/^Discard draft/i, /^Discard$/i]);
      if (discard) return realClick(discard);
    }
    const close =
      labeledButton([/^Save & close/i, /^Minimize/i], surface || document) ||
      exactButton("Save & close");
    if (close) return realClick(close); // already a pop-out window
    const pop =
      labeledButton([/^Pop out reply/i, /^Pop out/i], surface || document) ||
      exactButton("Pop out reply");
    if (pop) {
      realClick(pop);
      setTimeout(() => {
        const c = exactButton("Save & close");
        if (c) realClick(c);
      }, 160);
      return true;
    }
    const active = document.activeElement;
    if (active && active.isContentEditable) {
      active.blur();
      return true;
    }
    return false;
  }

  function composeSurface(body) {
    let el = body;
    while (el && el !== document.body) {
      if (
        labeledButton([/^Send\b/i, /^Discard draft/i, /^Discard$/i], el) ||
        el.getAttribute("role") === "dialog"
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return body ? body.parentElement : null;
  }

  // Find the scrollable ancestor of the first visible thread row and pin it to
  // top or bottom. Falls back to scrolling [role="main"].
  function listScrollContainer() {
    const row =
      Array.from(document.querySelectorAll('tr.zA')).filter(isVisible)[0] ||
      Array.from(document.querySelectorAll('[role="main"] [gh="tl"]')).filter(isVisible)[0] ||
      null;
    let el = row;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const oy = style.overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return Array.from(document.querySelectorAll('[role="main"]')).filter(isVisible)[0] || null;
  }

  function listScrollTop() {
    const el = listScrollContainer();
    if (el) el.scrollTop = 0;
  }

  function listScrollBottom() {
    const el = listScrollContainer();
    if (el) el.scrollTop = el.scrollHeight;
  }

  // The scrollable region that holds the OPEN CONVERSATION (a long single message
  // or the stack of message cards). Walk up from a rendered message to the nearest
  // scrollable ancestor (Gmail's is a div.Tm.aeJ), falling back to the visible
  // [role="main"]. Same pattern as listScrollContainer, kept separate because the
  // reading pane and the list pane are different scroll containers.
  function threadScrollContainer() {
    const msg = Array.from(document.querySelectorAll('[role="main"] [data-message-id]')).filter(isVisible)[0];
    let el = msg;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const oy = style.overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return Array.from(document.querySelectorAll('[role="main"]')).filter(isVisible)[0] || null;
  }

  // Scroll the reading pane (dir: 1 down, -1 up) by a fraction of its height.
  // Arrow keys use the default step; PageUp/PageDown pass a larger frac. We scroll
  // the container ourselves rather than relying on native arrow-scroll, because the
  // reading pane usually isn't the focused element, so the browser wouldn't scroll it.
  function threadScrollBy(dir, frac = 0.15) {
    const el = threadScrollContainer();
    if (!el) return false;
    const step = Math.max(80, Math.round(el.clientHeight * frac)) * dir;
    if (typeof el.scrollBy === "function") el.scrollBy({ top: step, behavior: "auto" });
    else el.scrollTop += step; // environments without scrollBy (e.g. jsdom)
    return true;
  }

  // Coarse "what am I looking at" classifier, in priority order. Drives the
  // hotkey context gate so bindings only fire where they make sense.
  function getContext() {
    // 1) Palette open.
    if (CMDK.palette && CMDK.palette.isOpen && CMDK.palette.isOpen()) return "paletteOpen";

    const active = document.activeElement;

    // 2) A modal dialog / menu is open (and not the compose surface itself).
    const dialogs = Array.from(
      document.querySelectorAll('[role="dialog"], [role="menu"]')
    ).filter(isVisible);
    const body = composeBody();
    for (const d of dialogs) {
      if (body && d.contains(body)) continue; // compose dialog handled below
      return "modalOpen";
    }

    // 3) Compose: focused contenteditable message body, or a visible standalone
    // compose body. Inline replies inside a thread should stop capturing global
    // hotkeys once Escape blurs the editor.
    if (active && active.isContentEditable && active.closest('[aria-label="Message Body"], [g_editable="true"], [contenteditable="true"][role="textbox"]')) {
      return "compose";
    }
    if (body && !inThread()) return "compose";

    // 4) Thread view: in a thread AND a rendered message present. This must win
    // over stale Gmail search focus after submitting a search query.
    if (inThread() && Array.from(document.querySelectorAll('[role="main"] [data-message-id]')).filter(isVisible)[0]) {
      return "threadView";
    }

    // 5) Inbox list: a visible thread row / thread-list area. Search results
    // render as a list while the search box can remain focused.
    if (
      Array.from(document.querySelectorAll('tr.zA')).filter(isVisible)[0] ||
      Array.from(document.querySelectorAll('[role="main"] [gh="tl"]')).filter(isVisible)[0]
    ) {
      return "inboxList";
    }

    // 6) Search field focused and no active list/thread surface is available.
    if (active && active.matches && active.matches('input[aria-label="Search mail"], input[name="q"]')) {
      return "searchFocused";
    }

    return "unknown";
  }

  CMDK.gmail = {
    accountIndex,
    basePath,
    setHash,
    inThread,
    findByTooltip,
    clickByTooltip,
    exactButton,
    realClick,
    compose,
    sendKey,
    isDispatchingSynthetic,
    action,
    currentEmail,
    composeBody,
    composeRecipients,
    composeSubject,
    hasOpenThreadReply,
    isVisible,
    back,
    replyToThread,
    replyAllToThread,
    forwardThread,
    nextThread,
    prevThread,
    archiveThread,
    exitReply,
    listScrollTop,
    listScrollBottom,
    threadScrollContainer,
    threadScrollBy,
    getContext,
  };
})();
