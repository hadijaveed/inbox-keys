const $ = (id) => document.getElementById(id);
const TOGGLES = ["enabled", "hotkeysEnabled", "tabsEnabled"];
const DEFAULT_ON = new Set(["enabled", "hotkeysEnabled", "tabsEnabled"]);

async function init() {
  const s = await chrome.storage.local.get([...TOGGLES, "accountNames"]);
  TOGGLES.forEach((k) => ($(k).checked = s[k] ?? DEFAULT_ON.has(k)));

  // Show current account email if we can read it from the active Gmail tab.
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab || !/mail\.google\.com/.test(tab.url || "")) {
      $("account").textContent = "Open Gmail to use";
      return;
    }
    const m = (tab.url || "").match(/\/mail\/u\/(\d+)\//);
    const idx = m ? m[1] : "0";
    const names = s.accountNames || {};
    $("account").textContent = names[idx] || `Account u/${idx}`;
  });
}

TOGGLES.forEach((k) =>
  document.addEventListener("change", (e) => {
    if (e.target.id === k) chrome.storage.local.set({ [k]: e.target.checked });
  })
);

function relay(payload) {
  chrome.runtime.sendMessage({ type: "mailpalette:relay", payload }, (res) => {
    if (res && !res.ok) $("note").textContent = "Open a Gmail tab first.";
    else window.close();
  });
}

$("open-palette").addEventListener("click", () => relay({ type: "mailpalette:open-palette" }));
$("open-tabs").addEventListener("click", () => relay({ type: "mailpalette:open-tabs-config" }));
$("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
