// Lightweight, self-contained toast notifications.
window.Mailpalette = window.Mailpalette || {};

(function () {
  let container = null;

  function ensure() {
    if (container) return container;
    container = document.createElement("div");
    container.className = "mailpalette-toast-stack";
    document.documentElement.appendChild(container);
    return container;
  }

  function toast(message, opts = {}) {
    // Tolerate the shorthand toast(msg, "warn") — some callers pass the kind
    // directly, and destructuring a string silently dropped it.
    if (typeof opts === "string") opts = { kind: opts };
    const { timeout = 2600, kind = "info" } = opts;
    const el = document.createElement("div");
    el.className = `mailpalette-toast mailpalette-toast--${kind}`;
    el.textContent = message;
    ensure().appendChild(el);
    requestAnimationFrame(() => el.classList.add("mailpalette-toast--in"));
    const remove = () => {
      el.classList.remove("mailpalette-toast--in");
      setTimeout(() => el.remove(), 200);
    };
    if (timeout) setTimeout(remove, timeout);
    el.addEventListener("click", remove);
    return remove;
  }

  Mailpalette.toast = toast;
})();
