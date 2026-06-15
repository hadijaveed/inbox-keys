// Lightweight, self-contained toast notifications.
window.InboxKeys = window.InboxKeys || {};

(function () {
  let container = null;

  function ensure() {
    if (container) return container;
    container = document.createElement("div");
    container.className = "inboxkeys-toast-stack";
    document.documentElement.appendChild(container);
    return container;
  }

  function toast(message, opts = {}) {
    // Tolerate the shorthand toast(msg, "warn") — some callers pass the kind
    // directly, and destructuring a string silently dropped it.
    if (typeof opts === "string") opts = { kind: opts };
    const { timeout = 2600, kind = "info" } = opts;
    const el = document.createElement("div");
    el.className = `inboxkeys-toast inboxkeys-toast--${kind}`;
    el.textContent = message;
    ensure().appendChild(el);
    requestAnimationFrame(() => el.classList.add("inboxkeys-toast--in"));
    const remove = () => {
      el.classList.remove("inboxkeys-toast--in");
      setTimeout(() => el.remove(), 200);
    };
    if (timeout) setTimeout(remove, timeout);
    el.addEventListener("click", remove);
    return remove;
  }

  InboxKeys.toast = toast;
})();
