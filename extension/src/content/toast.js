// Lightweight, self-contained toast notifications.
window.OpenSuperhuman = window.OpenSuperhuman || {};

(function () {
  let container = null;

  function ensure() {
    if (container) return container;
    container = document.createElement("div");
    container.className = "open-superhuman-toast-stack";
    document.documentElement.appendChild(container);
    return container;
  }

  function toast(message, opts = {}) {
    const { timeout = 2600, kind = "info" } = opts;
    const el = document.createElement("div");
    el.className = `open-superhuman-toast open-superhuman-toast--${kind}`;
    el.textContent = message;
    ensure().appendChild(el);
    requestAnimationFrame(() => el.classList.add("open-superhuman-toast--in"));
    const remove = () => {
      el.classList.remove("open-superhuman-toast--in");
      setTimeout(() => el.remove(), 200);
    };
    if (timeout) setTimeout(remove, timeout);
    el.addEventListener("click", remove);
    return remove;
  }

  OpenSuperhuman.toast = toast;
})();
