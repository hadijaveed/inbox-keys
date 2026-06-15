// Helpers for driving the Gmail UI from the content script.
//
// Strategy, in order of robustness:
//   1) Hash routing (#inbox, #sent, #search/...) — very stable, Gmail's own router.
//   2) Stable Gmail attributes ([gh="cm"] = compose, [gh="tm"] = toolbar).
//   3) Toolbar buttons matched by data-tooltip / aria-label (English; localizable later).
//   4) Native Gmail keyboard shortcuts as a fallback (requires shortcuts ON in Gmail).
window.InboxKeys = window.InboxKeys || {};

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
  // InboxKeys.hashutil.hashIsThread. (Earlier this assumed the id was the 2nd segment,
  // which broke threads opened from search: shortcuts died until you cleared the
  // search box.)
  function inThread() {
    return InboxKeys.hashutil.hashIsThread(location.hash || "");
  }

  // Visible-only query helper.
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Stricter "actually on screen" test for dialogs/menus. A [role=dialog] can
  // LINGER in Gmail's DOM after it closes — the attachment projector keeps its
  // full-window box (so the crude isVisible above is fooled) but is flagged
  // visibility:hidden / opacity:0 / aria-hidden="true". If we trust isVisible for
  // those, getContext() stays stuck on the closed preview and Escape (plus every
  // other thread shortcut) is hijacked into a no-op closeAttachmentPreview — the
  // reported "Escape stops working after opening an attachment" bug. An open
  // projector has none of these flags, so they cleanly separate the two states.
  // Tolerant of jsdom (sparse getComputedStyle); offsetParent is deliberately not
  // tested because it is null even for a genuinely open, position:fixed projector.
  function isShowing(el) {
    if (!isVisible(el)) return false;
    if (el.closest && el.closest('[aria-hidden="true"]')) return false;
    const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
    if (cs && (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0")) return false;
    return true;
  }

  // ---- Selector registry --------------------------------------------------
  // Single source of truth for every load-bearing Gmail DOM hook. Code reads
  // SEL.* instead of scattering literals; verifySelectors() below (surfaced in
  // the palette as "Verify Gmail selectors") and smoke/gmail-readonly-smoke.js
  // probe the same names, so "what we depend on" and "is it still there" can't
  // drift apart. When a shortcut dies in the field, run the verify command:
  // the failing probe names exactly what Gmail changed.
  const SEL = {
    // list surface
    listRow: "tr.zA",
    listRowFallback: '[gh="tl"] tr', // structural: any row in the thread-list area
    threadList: '[role="main"] [gh="tl"]',
    rowCheckbox: '[role="checkbox"]',
    // open conversation
    renderedMessage: '[role="main"] [data-message-id]',
    card: '[role="listitem"]',
    cardHeader: ".gE",
    messageBody: ".a3s",
    inlineActions: ".ams",
    // structural shape of an open conversation, for when [data-message-id]
    // is renamed: a message card header or a message body inside main.
    threadFallback: '[role="main"] [role="listitem"] .gE, [role="main"] .a3s',
    // app chrome
    main: '[role="main"]',
    composeButton: '[gh="cm"], [role="button"][gh="cm"]',
    toolbars: '[gh="tm"], [gh="mtb"], [role="toolbar"]',
    searchInput: 'input[aria-label="Search mail"], input[name="q"]',
    composeBody: 'div[aria-label="Message Body"], div[g_editable="true"], [contenteditable="true"][role="textbox"]',
  };

  // First visible match for a selector, or null.
  function firstVisible(sel, scope = document) {
    return Array.from(scope.querySelectorAll(sel)).filter(isVisible)[0] || null;
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

  // Gmail lays out a row's per-row action buttons (Archive, Delete, …) at 0x0
  // and reveals them only on mouseover. We navigate by keyboard and never move
  // the real pointer, so synthesize the hover to make those buttons clickable.
  // (Like realClick this drives DOM handlers, not the native keyboard router.)
  function hover(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    for (const type of ["pointerover", "mouseover", "pointermove", "mousemove"]) {
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

  function visibleControls(scope = document) {
    return Array.from(
      scope.querySelectorAll('a, button, [role="button"], [role="menuitem"], [role="link"], [aria-label], [data-tooltip], [title], .T-I, .ams')
    ).filter(isVisible);
  }

  function controlLabel(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("data-tooltip") ||
      el.getAttribute("title") ||
      el.getAttribute("download") ||
      el.textContent ||
      ""
    ).trim().replace(/\s+/g, " ");
  }

  function findControl(patterns, scope = document) {
    // Prefer Gmail's own control surfaces (toolbars) before scanning the whole
    // document: controlLabel falls back to textContent, so a document-wide scan
    // can match a link INSIDE an email body whose text happens to be exactly
    // "Mute" or "Move to inbox" and realClick mail content instead of a Gmail
    // control. Toolbars first; the generic scan stays as the fallback because
    // some controls legitimately live outside any toolbar (the Undo snackbar,
    // the per-message Unsubscribe header button).
    if (scope === document) {
      for (const bar of Array.from(document.querySelectorAll(SEL.toolbars)).filter(isVisible)) {
        const hit = visibleControls(bar).find((el) => patterns.some((p) => p.test(controlLabel(el))));
        if (hit) return hit;
      }
    }
    return (
      visibleControls(scope).find((el) => {
        const label = controlLabel(el);
        return patterns.some((p) => p.test(label));
      }) || null
    );
  }

  // Click el, or tell the user which Gmail control went missing. Most actions
  // drive a label-matched control; when Gmail renames one, the old behavior was
  // an eaten keystroke and total silence — and a user report is the only way we
  // ever find out. An action the user explicitly invoked must never fail
  // silently.
  function clickOr(el, what) {
    if (realClick(el)) return true;
    if (InboxKeys.toast) InboxKeys.toast(`Gmail control not found: ${what}`, { kind: "warn" });
    return false;
  }

  function attachmentPreviewDialog() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="presentation"]')).filter(isShowing);
    return (
      dialogs.find((dialog) => {
        const label = controlLabel(dialog).toLowerCase();
        if (/\b(pdf|attachment|preview|open with|download|print|add to drive)\b/.test(label)) return true;
        return !!findControl([/^Open with/i, /^Download$/i, /^Print$/i, /^Add to Drive$/i], dialog);
      }) || null
    );
  }

  function hasAttachmentPreview() {
    return !!attachmentPreviewDialog();
  }

  function closeAttachmentPreview() {
    const dialog = attachmentPreviewDialog();
    if (!dialog) return false;
    const close =
      findControl([/^Close$/i, /^Back$/i, /^Done$/i], dialog) ||
      findControl([/^Close$/i, /^Back$/i, /^Done$/i]);
    if (close && realClick(close)) return true;
    history.back();
    return true;
  }

  function compose() {
    const btn = document.querySelector(SEL.composeButton);
    if (btn && isVisible(btn)) {
      btn.click();
      return true;
    }
    // Fallback: Gmail compose deep-link.
    location.href = `${basePath()}#inbox?compose=new`;
    return true;
  }

  // Click the first visible control matching one of the tooltip prefixes.
  // There is deliberately NO synthetic-keyboard fallback here: Gmail ignores
  // synthetic key events (isTrusted === false), so the old fallback "succeeded"
  // while doing nothing and masked real selector breakage. A missing control
  // now toasts so the failure is visible in the field.
  function action(tooltipPrefixes, what) {
    const prefixes = [].concat(tooltipPrefixes);
    for (const p of prefixes) {
      if (clickByTooltip(p)) return true;
    }
    if (InboxKeys.toast) {
      InboxKeys.toast(`Gmail control not found: ${what || prefixes[0]}`, { kind: "warn" });
    }
    return false;
  }

  function undo() {
    const btn = findControl([/^Undo$/i]);
    if (btn) return realClick(btn);
    if (InboxKeys.toast) InboxKeys.toast("Nothing to undo", { kind: "info" });
    return false;
  }

  function toggleStar(scope = document) {
    return clickOr(findControl([
      /^Star$/i,
      /^Not starred$/i,
      /^Add star$/i,
      /^Remove star$/i,
      /^Starred$/i,
    ], scope), "Star");
  }

  function attachFile() {
    const input = Array.from(document.querySelectorAll('input[type="file"]')).filter(isVisible)[0];
    if (input) return realClick(input);
    return realClick(findControl([/^Attach files?$/i, /^Attach$/i, /\bAttach files?\b/i]));
  }

  function discardDraft() {
    const body = composeBody();
    const surfaces = [
      body && body.closest('[role="dialog"], [role="listitem"], .M9, .AD, .nH'),
      ...Array.from(document.querySelectorAll('[role="dialog"], [role="listitem"], .M9, .AD, .nH')).filter(isVisible),
      document,
    ].filter(Boolean);
    let btn = null;
    for (const surface of surfaces) {
      btn =
        labeledButton([/^Discard draft$/i, /^Discard$/i, /^Delete draft$/i], surface) ||
        findControl([/^Discard draft$/i, /^Discard$/i, /^Delete draft$/i], surface) ||
        Array.from(
          surface.querySelectorAll('[aria-label*="Discard"], [data-tooltip*="Discard"], [title*="Discard"], [aria-label*="Delete draft"], [data-tooltip*="Delete draft"], [title*="Delete draft"]')
        ).filter(isVisible)[0] ||
        null;
      if (btn) break;
    }
    if (btn) return realClick(btn);
    if (InboxKeys.toast) InboxKeys.toast("No draft discard button found", { kind: "warn" });
    return false;
  }

  function markReadUnread() {
    return clickOr(findControl([/^Mark as read$/i, /^Mark as unread$/i, /^Mark read$/i, /^Mark unread$/i]), "Mark as read/unread");
  }

  function snooze() {
    const btn = findControl([/^Snooze\b/i, /^Remind me\b/i]);
    if (btn) return realClick(btn);
    if (InboxKeys.toast) InboxKeys.toast("No snooze button found", { kind: "warn" });
    return false;
  }

  function markNotDone() {
    return clickOr(findControl([/^Move to inbox$/i, /^Mark not done$/i, /^Not done$/i]), "Move to inbox");
  }

  function mute() {
    return clickOr(findControl([/^Mute$/i]), "Mute");
  }

  function unsubscribe() {
    const btn = findControl([/^Unsubscribe\b/i, /\bUnsubscribe\b/i]);
    if (!btn) {
      if (InboxKeys.toast) InboxKeys.toast("No unsubscribe action found", { kind: "warn" });
      return false;
    }
    realClick(btn);
    waitFor(
      () => {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).filter(isVisible)[0];
        return dialog ? findControl([/^Unsubscribe$/i, /^OK$/i, /^Confirm$/i], dialog) : null;
      },
      (confirm) => realClick(confirm),
      null,
      8,
      80
    );
    return true;
  }

  function openLinkOrAttachment(scope = document) {
    const root = scope || document;
    const candidates = Array.from(
      root.querySelectorAll(
        'a[href], [role="link"], [download], [aria-label], [data-tooltip], [title], [role="button"]'
      )
    ).filter(isVisible);
    const target = candidates.find((el) => {
      const href = el.getAttribute("href") || "";
      if (href && !/^mailto:/i.test(href) && href !== "#") return true;
      const label = controlLabel(el);
      return /\b(attachment|download|open|preview)\b/i.test(label);
    });
    if (target) return realClick(target);
    if (InboxKeys.toast) InboxKeys.toast("No link or attachment found", { kind: "warn" });
    return false;
  }

  function openLabelMenu() {
    return clickOr(findControl([/^Label$/i, /^Labels$/i, /^Label as$/i]), "Label menu");
  }

  function removeLabel() {
    return clickOr(findControl([/^Remove label$/i, /^Remove$/i]), "Remove label");
  }

  function removeAllLabels() {
    return clickOr(findControl([/^Remove all labels$/i]), "Remove all labels");
  }

  function openMoveMenu() {
    return clickOr(findControl([/^Move$/i, /^Move to$/i]), "Move menu");
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
    const editors = Array.from(document.querySelectorAll(SEL.composeBody)).filter(isVisible);
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
  // We deliberately do NOT fall back to a synthetic "u" key: Gmail ignores synthetic
  // keyboard events (isTrusted === false) for native navigation, so a fake "u"
  // silently does nothing. Hash routing is trusted and always works.
  function back() {
    const parent = InboxKeys.hashutil.parentHash(location.hash || "");
    const sels = [
      '[aria-label^="Back to"]',
      '[data-tooltip^="Back to"]',
      'div[role="button"][aria-label^="Back"]',
    ];
    for (const sel of sels) {
      const el = Array.from(document.querySelectorAll(sel)).filter(isVisible)[0];
      if (el) {
        realClick(el);
        location.hash = parent;
        return true;
      }
    }
    location.hash = parent;
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
  // per-message reply arrow icon. Only the document-wide lookup toasts on
  // failure: a card-scoped miss is normal (callers fall through to document).
  function replyToThread(scope = document) {
    const opened = realClick(
      amsButton(/^reply$/i, scope) ||
        labeledButton([/^Reply(?!\s+(all|to all))\b/i], scope) ||
        exactButton("Reply", scope)
    );
    if (opened) focusReplyBodySoon();
    else if (scope === document && InboxKeys.toast) {
      InboxKeys.toast("Gmail control not found: Reply", { kind: "warn" });
    }
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
    return clickOr(
      amsButton(/^forward\b/i) ||
        labeledButton([/^Forward\b/i]) ||
        exactButton("Forward"),
      "Forward"
    );
  }

  // Older = next (further down the list), Newer = previous.
  function nextThread() {
    return clickOr(exactButton("Older"), "Older (next conversation)");
  }
  function prevThread() {
    return clickOr(exactButton("Newer"), "Newer (previous conversation)");
  }

  // List pager: in a list view Gmail's "Older"/"Newer" toolbar buttons step to the
  // next/previous PAGE of results (the same controls page conversations in a thread).
  // Newer = previous page, Older = next page. The button is aria-disabled at the
  // first/last page, so realClick is a harmless no-op at the boundary.
  //
  // SEARCH RESULTS are the exception and caused the "doesn't work with a label or
  // search" report: a search view still renders the "Older"/"Newer" toolbar but
  // keeps it HIDDEN, and exposes its OWN visible pager labeled "Next results" /
  // "Previous results" instead (verified live: #search/<q> → #search/<q>/p2).
  // exactButton already filters by visibility, so it skips the hidden Older/Newer
  // and we fall through to the search labels. Labels and All Mail keep "Older"/
  // "Newer" visible, so they use the first match. Next = older/forward, Previous =
  // newer/back, matching the Older/Newer direction.
  function nextPage() {
    return realClick(exactButton("Older") || exactButton("Next results"));
  }
  function prevPage() {
    return realClick(exactButton("Newer") || exactButton("Previous results"));
  }

  // Archive the open thread via its toolbar icon (returns to the list).
  function archiveThread() {
    return clickOr(exactButton("Archive"), "Archive");
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
    const row = firstVisible(SEL.listRow) || firstVisible(SEL.threadList);
    let el = row;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const oy = style.overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return firstVisible(SEL.main);
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
    const msg = firstVisible(SEL.renderedMessage) || firstVisible(SEL.threadFallback);
    let el = msg;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const oy = style.overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return firstVisible(SEL.main);
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

  // In-Gmail smoke probe over the selector registry: check every probe that
  // should exist on the CURRENT surface (list vs thread) and report what is
  // missing. Run from the palette ("Verify Gmail selectors") when a shortcut
  // stops working — the failing probe names exactly what Gmail changed,
  // without devtools archaeology. Conditional controls (the pager, hover-only
  // row buttons) are deliberately not probed: their absence is often
  // legitimate, and a smoke check that cries wolf gets ignored.
  const PROBES = [
    { name: "search input", sel: SEL.searchInput, requiredIn: "always" },
    { name: "main region", sel: SEL.main, requiredIn: "always" },
    { name: "compose button", sel: SEL.composeButton, requiredIn: "always" },
    { name: "list rows (tr.zA)", sel: SEL.listRow, requiredIn: "list" },
    { name: "thread list area", sel: SEL.threadList, requiredIn: "list" },
    { name: "row checkboxes", sel: SEL.listRow + " " + SEL.rowCheckbox, requiredIn: "list" },
    { name: "toolbar", sel: SEL.toolbars, requiredIn: "list" },
    { name: "rendered message", sel: SEL.renderedMessage, requiredIn: "thread" },
    { name: "message cards", sel: '[role="main"] ' + SEL.card, requiredIn: "thread" },
    { name: "card headers", sel: '[role="main"] ' + SEL.card + " " + SEL.cardHeader, requiredIn: "thread" },
    { name: "message bodies", sel: '[role="main"] ' + SEL.messageBody, requiredIn: "thread" },
    { name: "inline reply links (.ams)", sel: SEL.inlineActions, requiredIn: "thread" },
  ];

  function verifySelectors() {
    const surface = inThread() ? "thread" : "list";
    const results = PROBES.map((p) => {
      const applies = p.requiredIn === "always" || p.requiredIn === surface;
      const count = Array.from(document.querySelectorAll(p.sel)).filter(isVisible).length;
      return { probe: p.name, selector: p.sel, requiredIn: p.requiredIn, applies, count, ok: !applies || count > 0 };
    });
    const failed = results.filter((r) => !r.ok);
    if (typeof console !== "undefined" && console.table) console.table(results);
    if (InboxKeys.toast) {
      if (failed.length) {
        InboxKeys.toast(
          `Selector check: ${failed.length} FAILED — ${failed.map((r) => r.probe).join(", ")} (details in console)`,
          { kind: "warn", timeout: 6000 }
        );
      } else {
        const checked = results.filter((r) => r.applies).length;
        InboxKeys.toast(`Selector check: all ${checked} probes OK on this ${surface} view`, { kind: "info" });
      }
    }
    return { surface, results, failed };
  }

  // Coarse "what am I looking at" classifier, in priority order. Drives the
  // hotkey context gate so bindings only fire where they make sense.
  function getContext() {
    // 1) Palette open.
    if (InboxKeys.palette && InboxKeys.palette.isOpen && InboxKeys.palette.isOpen()) return "paletteOpen";

    const active = document.activeElement;

    // 2) A modal dialog / menu is open (and not the compose surface itself).
    // isShowing (not isVisible) so a closed-but-lingering dialog — notably the
    // attachment projector, which stays sized but visibility:hidden/aria-hidden
    // after Escape — doesn't keep us stuck in modalOpen/attachmentPreview.
    const dialogs = Array.from(
      document.querySelectorAll('[role="dialog"], [role="menu"]')
    ).filter(isShowing);
    const body = composeBody();
    for (const d of dialogs) {
      if (body && d.contains(body)) continue; // compose dialog handled below
      if (inThread() && attachmentPreviewDialog() === d) return "attachmentPreview";
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
    // over stale Gmail search focus after submitting a search query. The
    // [data-message-id] probe is primary; if Gmail ever renames it, the
    // structural shape of an open conversation (a card header or message body
    // inside main) keeps thread detection alive. Both stay gated by inThread()
    // so a list never classifies as a thread (the long-bare-word query guard).
    if (inThread() && (firstVisible(SEL.renderedMessage) || firstVisible(SEL.threadFallback))) {
      return "threadView";
    }

    // 5) Inbox list: a visible thread row / thread-list area. Search results
    // render as a list while the search box can remain focused.
    if (firstVisible(SEL.listRow) || firstVisible(SEL.threadList)) {
      return "inboxList";
    }

    // 6) Search field focused and no active list/thread surface is available.
    if (active && active.matches && active.matches(SEL.searchInput)) {
      return "searchFocused";
    }

    return "unknown";
  }

  InboxKeys.gmail = {
    SEL,
    firstVisible,
    verifySelectors,
    accountIndex,
    basePath,
    setHash,
    inThread,
    findByTooltip,
    clickByTooltip,
    exactButton,
    realClick,
    hover,
    compose,
    action,
    undo,
    toggleStar,
    attachFile,
    discardDraft,
    markReadUnread,
    snooze,
    markNotDone,
    mute,
    unsubscribe,
    openLinkOrAttachment,
    openLabelMenu,
    removeLabel,
    removeAllLabels,
    openMoveMenu,
    currentEmail,
    composeBody,
    composeRecipients,
    composeSubject,
    hasOpenThreadReply,
    hasAttachmentPreview,
    closeAttachmentPreview,
    isVisible,
    back,
    replyToThread,
    replyAllToThread,
    forwardThread,
    nextThread,
    prevThread,
    nextPage,
    prevPage,
    archiveThread,
    exitReply,
    listScrollContainer,
    listScrollTop,
    listScrollBottom,
    threadScrollContainer,
    threadScrollBy,
    getContext,
  };
})();
