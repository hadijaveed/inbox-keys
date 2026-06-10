const assert = require("node:assert/strict");
const { tryLoadContentScripts } = require("./helpers.js");

if (!tryLoadContentScripts("")) {
  console.log("tabs config tests skipped (jsdom not installed - run: npm install)");
  process.exit(0);
}

function load() {
  const w = tryLoadContentScripts('<div role="main"></div>');
  w.Mailpalette.storage.cache = {
    ...w.Mailpalette.DEFAULTS,
    tabs: w.Mailpalette.DEFAULTS.tabs.map((tab) => ({ ...tab })),
    keyOverrides: {},
  };
  return w;
}

function openModal(w, pane) {
  w.Mailpalette.tabs.openConfig(pane);
  return w.document.querySelector(".mailpalette-cfg");
}

function click(w, el) {
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function input(w, el, value) {
  el.value = value;
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
}

function keydown(w, key, opts = {}) {
  w.document.dispatchEvent(
    new w.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      metaKey: !!opts.metaKey,
      ctrlKey: !!opts.ctrlKey,
      altKey: !!opts.altKey,
      shiftKey: !!opts.shiftKey,
    })
  );
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

(async () => {
  {
    const w = load();
    const modal = openModal(w);

    assert.ok(modal, "settings modal should render");
    assert.ok(modal.querySelector('[data-settings-tab="tabs"]'), "settings modal should have a tabs section tab");
    assert.ok(modal.querySelector('[data-settings-tab="shortcuts"]'), "settings modal should have a keyboard shortcuts section tab");
    assert.equal(modal.querySelector('[data-settings-panel="tabs"]').hidden, false, "tabs settings should be the default full modal view");
    assert.equal(modal.querySelector('[data-settings-panel="shortcuts"]').hidden, true, "shortcut settings should not share the same view by default");
    click(w, modal.querySelector('[data-settings-tab="shortcuts"]'));
    assert.equal(modal.querySelector('[data-settings-panel="tabs"]').hidden, true, "tabs panel should hide when shortcuts tab is active");
    assert.equal(modal.querySelector('[data-settings-panel="shortcuts"]').hidden, false, "shortcut settings should be a full modal tab view");
    assert.ok(modal.querySelector('.mailpalette-shortcut-search[type="search"]'), "shortcuts should be searchable");
    assert.ok(modal.querySelector('[data-id="archive"]'), "shortcut list should include command rows");
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    input(w, modal.querySelector(".mailpalette-shortcut-search"), "star");

    const rows = Array.from(modal.querySelectorAll(".mailpalette-shortcut-row"));
    assert.ok(rows.length >= 1, "search should leave matching shortcut rows");
    assert.ok(rows.some((row) => /star/i.test(row.textContent)), "search should match shortcut titles");
    assert.equal(rows.some((row) => /Compose new email/i.test(row.textContent)), false, "search should filter unrelated shortcuts");
    assert.match(modal.querySelector(".mailpalette-shortcut-count").textContent, /shown/);
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    input(w, modal.querySelector(".mailpalette-shortcut-search"), w.Mailpalette_KEYMAP.modLabel().toLowerCase());

    const rows = Array.from(modal.querySelectorAll(".mailpalette-shortcut-row"));
    assert.ok(rows.some((row) => /(Cmd|Ctrl)\+U/.test(row.textContent)), "search should match visible Command/Ctrl shortcut labels");
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    const archiveRow = modal.querySelector('[data-id="archive"]');
    click(w, archiveRow.querySelector(".mailpalette-shortcut-keys"));
    keydown(w, "q");

    assert.deepEqual(w.Mailpalette.storage.get("keyOverrides"), {}, "recording should not persist until Save is clicked");

    click(w, modal.querySelector(".mailpalette-cfg-save"));
    await flush();

    assert.equal(w.Mailpalette.storage.get("keyOverrides").archive[0], "q", "Save should persist the recorded shortcut");
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    const archiveRow = modal.querySelector('[data-id="archive"]');
    click(w, archiveRow.querySelector(".mailpalette-shortcut-keys"));
    keydown(w, "e", { ctrlKey: true });

    click(w, modal.querySelector(".mailpalette-cfg-save"));
    await flush();

    assert.equal(w.Mailpalette.storage.get("keyOverrides").archive[0], "Ctrl+e", "recorder should persist Ctrl plus letter shortcuts");
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    const fixed = modal.querySelector('[data-id="attach-file"] .mailpalette-shortcut-keys');

    assert.equal(fixed.disabled, true, "engine-owned shortcuts should be read-only");
    assert.equal(/Mod/.test(fixed.textContent), false, "visible shortcut chips should not show abstract Mod");
    assert.match(fixed.textContent, /(Cmd|Ctrl)\+U/, "visible shortcut chips should show platform-specific Command/Ctrl text");
  }

  {
    const w = load();
    const modal = openModal(w, "shortcuts");
    const archiveRow = modal.querySelector('[data-id="archive"]');
    click(w, archiveRow.querySelector(".mailpalette-shortcut-keys"));
    keydown(w, "0");

    click(w, modal.querySelector(".mailpalette-cfg-save"));
    await flush();

    assert.equal(w.Mailpalette.storage.get("keyOverrides").archive, undefined, "reserved fixed shortcuts should not be stolen");
  }

  {
    const w = load();
    w.Mailpalette.storage.cache = {
      ...w.Mailpalette.storage.cache,
      keyOverrides: { archive: ["q"], compose: ["x"] },
    };
    const modal = openModal(w, "shortcuts");

    click(w, modal.querySelector(".mailpalette-shortcut-reset-all"));
    click(w, modal.querySelector(".mailpalette-cfg-save"));
    await flush();

    assert.equal(Object.keys(w.Mailpalette.storage.get("keyOverrides")).length, 0, "reset all should clear shortcut overrides on Save");
  }

  {
    const w = load();
    const settings = w.Mailpalette.commands.all().find((cmd) => cmd.id === "mailpalette-settings");
    const shortcuts = w.Mailpalette.commands.all().find((cmd) => cmd.id === "shortcuts-config");

    assert.ok(settings, "Command palette should include an Mailpalette settings command");
    assert.ok(shortcuts, "Command palette should include a keyboard shortcuts settings command");

    shortcuts.run();
    const modal = w.document.querySelector(".mailpalette-cfg");
    assert.ok(modal, "settings command should open the in-Gmail settings modal");
    assert.equal(modal.querySelector('[data-settings-panel="shortcuts"]').hidden, false, "keyboard shortcuts command should open the shortcuts tab");
  }

  {
    const w = load();
    assert.equal(/Mod/.test(w.Mailpalette_KEYMAP.displayBinding("Mod+K")), false, "display helper should not expose Mod");
    assert.match(w.Mailpalette_KEYMAP.displayBinding("Mod+K"), /^(Cmd|Ctrl)\+K$/);
    w.Mailpalette.palette.show();
    assert.equal(/Mod/.test(w.document.querySelector(".mailpalette-prompt").textContent), false, "Command K prompt should not show Mod");
  }

  console.log("tabs config tests passed");
})();
