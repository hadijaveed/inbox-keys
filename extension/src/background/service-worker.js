// Minimal MV3 service worker. The heavy lifting is in the content script; this
// just relays popup actions to the active Gmail tab and seeds defaults.
chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(["enabled"]);
  if (cur.enabled === undefined) {
    await chrome.storage.local.set({ enabled: true, hotkeysEnabled: true });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "cmdk:relay") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && /mail\.google\.com/.test(tab.url || "")) {
        chrome.tabs.sendMessage(tab.id, msg.payload);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, reason: "not-gmail" });
      }
    });
    return true; // async response
  }
});
