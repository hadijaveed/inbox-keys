// Lightweight, self-contained toast notifications.
window.CMDK = window.CMDK || {};

(function () {
  let container = null;

  function ensure() {
    if (container) return container;
    container = document.createElement("div");
    container.className = "cmdk-toast-stack";
    document.documentElement.appendChild(container);
    return container;
  }

  function toast(message, opts = {}) {
    const { timeout = 2600, kind = "info" } = opts;
    const el = document.createElement("div");
    el.className = `cmdk-toast cmdk-toast--${kind}`;
    el.textContent = message;
    ensure().appendChild(el);
    requestAnimationFrame(() => el.classList.add("cmdk-toast--in"));
    const remove = () => {
      el.classList.remove("cmdk-toast--in");
      setTimeout(() => el.remove(), 200);
    };
    if (timeout) setTimeout(remove, timeout);
    el.addEventListener("click", remove);
    return remove;
  }

  CMDK.toast = toast;
})();
