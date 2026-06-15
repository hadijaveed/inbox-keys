// Calendar quick-open.
//
// Bound to the bare "0" key (handled in hotkeys.js, top-level views only):
//   0   -> toggle Gmail's right-side Calendar panel (the right-rail button);
//          falls back to a half-screen popup window if the button isn't there.
//   0 0 -> open Google Calendar in a new browser tab.
// The calendar opens for the account you're currently in (/calendar/u/N).
window.InboxKeys = window.InboxKeys || {};

(function () {
  const { gmail } = InboxKeys;

  function url() {
    const idx = gmail ? gmail.accountIndex() : 0;
    return `https://calendar.google.com/calendar/u/${idx}/r`;
  }

  // Gmail's right-rail toggles are role="tab" controls that ignore a bare
  // element.click() — they only react to a full pointer + mouse event sequence
  // at the element's center. So we synthesize the whole gesture.
  function realClick(el) {
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ctor = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, opts));
    }
  }

  // Toggle Gmail's right-rail Calendar panel, if the toggle is present/visible.
  function clickSidePanel() {
    const sels = [
      '[aria-label="Calendar"][role="tab"]',
      '[data-tooltip="Calendar"][role="tab"]',
      '[aria-label="Calendar"]',
      '[data-tooltip="Calendar"]',
      'div[role="button"][aria-label^="Calendar"]',
    ];
    for (const sel of sels) {
      const el = Array.from(document.querySelectorAll(sel)).filter((e) => gmail && gmail.isVisible(e))[0];
      if (el) {
        realClick(el);
        return true;
      }
    }
    return false;
  }

  // A right-half popup window so calendar sits beside Gmail.
  function openPopup() {
    const sw = screen.availWidth;
    const sh = screen.availHeight;
    const w = Math.round(sw / 2);
    const left = (screen.availLeft || 0) + (sw - w);
    const top = screen.availTop || 0;
    const feats = `popup=yes,width=${w},height=${sh},left=${left},top=${top},noopener`;
    const win = window.open(url(), "inboxkeys-calendar", feats);
    if (!win) InboxKeys.toast("Allow pop-ups for mail.google.com to open the calendar", { kind: "warn" });
  }

  function open(mode) {
    if (mode === "tab") {
      window.open(url(), "_blank", "noopener");
      return;
    }
    // "side" (or legacy "half"): prefer Gmail's built-in panel toggle, fall
    // back to the half-screen popup window.
    if (!clickSidePanel()) openPopup();
  }

  InboxKeys.calendar = { open };
})();
