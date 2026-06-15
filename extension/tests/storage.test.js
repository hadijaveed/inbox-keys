const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch {
  console.log("storage tests skipped (jsdom not installed — run: npm install)");
  process.exit(0);
}

const root = path.resolve(__dirname, "..");
const storageScript = fs.readFileSync(path.join(root, "src/content/storage.js"), "utf8");

async function loadWithStoredTabs(tabs) {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    url: "https://mail.google.com/mail/u/0/",
    runScripts: "outside-only",
  });
  const { window } = dom;
  let savedPatch = null;
  window.chrome = {
    storage: {
      local: {
        get: async () => ({ tabs }),
        set: async (patch) => {
          savedPatch = patch;
        },
      },
      onChanged: { addListener() {} },
    },
  };
  window.eval(storageScript);
  const cache = await window.InboxKeys.storage.load();
  return { cache, savedPatch };
}

(async () => {
  const { cache, savedPatch } = await loadWithStoredTabs([
    { id: "inbox", name: "Inbox", type: "inbox", query: "" },
    { id: "unread", name: "Unread", type: "search", query: "is:unread" },
    { id: "important", name: "Important", type: "search", query: "is:important" },
    { id: "starred", name: "Starred", type: "search", query: "is:starred" },
    { id: "attachments", name: "Attachments", type: "search", query: "has:attachment" },
  ]);

  assert.equal(cache.tabs[1].query, "in:inbox is:unread");
  assert.equal(cache.tabs[2].query, "in:inbox is:important");
  assert.equal(cache.tabs[3].query, "in:inbox is:starred");
  assert.equal(cache.tabs[4].query, "in:inbox has:attachment");
  assert.equal(savedPatch.tabs[1].query, "in:inbox is:unread", "migrated tabs should persist back to chrome storage");

  const custom = await loadWithStoredTabs([
    { id: "unread", name: "Unread", type: "search", query: "label:Clients is:unread" },
  ]);

  assert.equal(custom.cache.tabs[0].query, "label:Clients is:unread", "custom tab queries should not be migrated");
  assert.equal(custom.savedPatch, null, "custom tabs should not be rewritten");

  console.log("storage tests passed");
})();
