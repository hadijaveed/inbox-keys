// Loads the real content-script modules (hashutil.js + gmail.js) into a jsdom
// window so getContext() can be exercised end-to-end against actual hash + DOM
// states — no re-implementation, no stubbing of the logic under test.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
function src(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function makeWindow(bodyHtml) {
  let JSDOM;
  try {
    ({ JSDOM } = require("jsdom"));
  } catch {
    return null;
  }
  const dom = new JSDOM("<!DOCTYPE html><body>" + (bodyHtml || "") + "</body>", {
    url: "https://mail.google.com/mail/u/0/",
    runScripts: "outside-only", // gives a window-scoped eval; page has no scripts
  });
  const { window } = dom;

  window.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
      onChanged: { addListener() {} },
    },
  };
  window.open = (...args) => {
    window.__openedWindow = args;
    return { focus() {} };
  };

  // Every element jsdom renders has a 0x0 box; getContext's isVisible() treats
  // 0x0 as hidden. Make present elements count as visible.
  window.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0, toJSON() {} };
  };
  window.Element.prototype.scrollIntoView = function () {
    window.__lastScrollIntoView = this;
  };

  return window;
}

function loadScripts(window, scripts) {
  for (const rel of scripts) window.eval(src(rel));
}

// Returns a window with OpenSuperhuman.gmail wired up, or null if jsdom isn't installed
// (so the suite degrades to a skip instead of a hard failure on a clean clone).
function tryLoad(bodyHtml) {
  const window = makeWindow(bodyHtml);
  if (!window) return null;

  // Load the modules in manifest order. window.eval runs them in the window's
  // global scope, so their `window.OpenSuperhuman.*` assignments stick and `module` is
  // undefined (dual-export takes the browser branch).
  loadScripts(window, ["src/shared/hashutil.js", "src/content/gmail.js"]);

  // getContext checks OpenSuperhuman.palette.isOpen(); drive it from a window flag.
  window.OpenSuperhuman.palette = { isOpen: () => window.__paletteOpen === true };
  return window;
}

function tryLoadContentScripts(bodyHtml) {
  const window = makeWindow(bodyHtml);
  if (!window) return null;
  loadScripts(window, [
    "src/shared/hashutil.js",
    "src/shared/keymap.js",
    "src/content/storage.js",
    "src/content/toast.js",
    "src/content/gmail.js",
    "src/content/accounts.js",
    "src/content/calendar.js",
    "src/content/listnav.js",
    "src/content/threadnav.js",
    "src/content/tabs.js",
    "src/content/commands.js",
    "src/content/palette.js",
    "src/content/hotkeys.js",
  ]);
  return window;
}

module.exports = { tryLoad, tryLoadContentScripts };
