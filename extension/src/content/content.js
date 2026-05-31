// Bootstrap: load settings, then wire up the palette, hotkeys, accounts, and
// the split-inbox tab bar once Gmail's app is ready.
(async function () {
  const { storage, hotkeys, accounts, palette, tabs } = CMDK;

  await storage.load();

  hotkeys.install();
  tabs.init();

  // Learn the current account, and re-check as Gmail re-renders / navigates.
  const learn = () => accounts.rememberCurrent().catch(() => {});
  learn();
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      learn();
    }
  }, 1500);
  // Gmail mutates the DOM heavily after load; one delayed pass catches the avatar.
  setTimeout(learn, 4000);

  // React to settings changes from the popup/options pages live.
  storage.onChange(() => {});

  // Let the popup/background drive the content script via messages.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "cmdk:open-palette") palette.show();
    if (msg && msg.type === "cmdk:open-tabs-config") tabs.openConfig();
  });

  console.log("[Open Superhuman] ready on", location.host);
})();
