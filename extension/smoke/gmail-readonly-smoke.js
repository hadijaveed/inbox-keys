#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");

const ROOT = path.resolve(__dirname, "..");
const EXTENSION_DIR = ROOT;
const SMOKE_DIR = path.join(ROOT, ".smoke");
const PROFILE_DIR = process.env.INBOXKEYS_SMOKE_PROFILE || path.join(SMOKE_DIR, "chrome-profile");
const ARTIFACT_DIR = path.join(SMOKE_DIR, "artifacts");
const GMAIL_URL = process.env.INBOXKEYS_SMOKE_URL || "https://mail.google.com/mail/u/0/#inbox";

const args = process.argv.slice(2);
const mode = args[0] || "readonly";
const headed = args.includes("--headed") || mode === "setup";

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    console.error("Playwright is not installed.");
    console.error("Run: cd extension && npm run smoke:install");
    process.exit(1);
  }
}

function ensureDirs() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

function chromeModifier() {
  return process.platform === "darwin" ? "Meta" : "Control";
}

async function launchContext(chromium) {
  ensureDirs();
  const launchOptions = {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--disable-features=Translate",
    ],
  };
  const channel = process.env.INBOXKEYS_CHROME_CHANNEL;
  if (channel) launchOptions.channel = channel;
  return chromium.launchPersistentContext(PROFILE_DIR, launchOptions);
}

async function setup() {
  const { chromium } = loadPlaywright();
  const context = await launchContext(chromium);
  const page = context.pages()[0] || await context.newPage();
  await page.goto(GMAIL_URL, { waitUntil: "domcontentloaded" });

  console.log("");
  console.log("Gmail smoke setup");
  console.log("1. Log into the dedicated Gmail smoke account in the opened browser.");
  console.log("2. Leave the browser on Gmail inbox.");
  console.log("3. Press Enter here when login is complete.");
  console.log("");
  console.log(`Profile: ${PROFILE_DIR}`);
  console.log("No Gmail password is read or stored by this script.");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter after Gmail is logged in...");
  rl.close();
  await context.close();
  console.log("Setup complete. Run: npm run smoke:gmail:readonly");
}

async function waitForGmailOrLogin(page) {
  await page.goto(GMAIL_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const hasGmail =
      !!document.querySelector('input[aria-label="Search mail"], input[name="q"]') ||
      !!document.querySelector('[role="main"] [gh="tl"], tr.zA, [data-message-id]');
    const hasLogin =
      !!document.querySelector('input[type="email"], input[name="identifier"], input[type="password"]') ||
      /accounts\.google\.com/.test(location.hostname);
    return { hasGmail, hasLogin, href: location.href, title: document.title };
  });

  if (state.hasLogin && !state.hasGmail) {
    throw new Error("Gmail is not logged in for the smoke profile. Run: npm run smoke:gmail:setup");
  }
  if (!state.hasGmail) {
    throw new Error(`Gmail did not render expected app selectors. Current page: ${state.href}`);
  }
  return state;
}

async function probeSelectors(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const count = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible).length;
    const probes = [
      { name: "search input", selector: 'input[aria-label="Search mail"], input[name="q"]', required: true },
      { name: "main region", selector: '[role="main"]', required: true },
      { name: "thread list rows", selector: "tr.zA", required: true },
      { name: "thread list area", selector: '[role="main"] [gh="tl"]', required: true },
      { name: "row checkboxes", selector: 'tr.zA [role="checkbox"]', required: true },
      { name: "compose button", selector: '[gh="cm"], [role="button"][gh="cm"]', required: true },
      { name: "toolbar", selector: '[gh="tm"], [gh="mtb"], [role="toolbar"]', required: false },
      { name: "message cards", selector: '[role="main"] [role="listitem"]', required: false },
      { name: "message headers", selector: '[role="main"] [role="listitem"] .gE', required: false },
      { name: "message bodies", selector: '[role="main"] [data-message-id], [role="main"] .a3s', required: false },
      { name: "inline reply links", selector: ".ams", required: false },
      { name: "attach controls", selector: 'input[type="file"], [aria-label*="Attach"], [data-tooltip*="Attach"]', required: false },
    ];
    return probes.map((probe) => ({
      ...probe,
      count: count(probe.selector),
      ok: probe.required ? count(probe.selector) > 0 : true,
    }));
  });
}

async function verifyExtensionPalette(page) {
  const mod = chromeModifier();
  await page.keyboard.press(`${mod}+K`);
  await page.waitForTimeout(300);
  const opened = await page.locator(".inboxkeys-modal").count();
  if (!opened) throw new Error("Cmd/Ctrl+K did not open the InboxKeys command palette.");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
}

async function verifySearchFocus(page) {
  await page.keyboard.press("/");
  await page.waitForTimeout(200);
  const focused = await page.evaluate(() => {
    const active = document.activeElement;
    return !!(active && active.matches && active.matches('input[aria-label="Search mail"], input[name="q"]'));
  });
  if (!focused) throw new Error("/ did not focus Gmail search.");
  await page.keyboard.press("Escape");
}

async function readonly() {
  const { chromium } = loadPlaywright();
  const context = await launchContext(chromium);
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(10000);

  const result = {
    mode: "readonly",
    url: GMAIL_URL,
    profile: PROFILE_DIR,
    startedAt: new Date().toISOString(),
    checks: [],
  };

  try {
    const state = await waitForGmailOrLogin(page);
    result.gmail = state;
    result.checks.push({ name: "gmail logged in", ok: true });

    const probes = await probeSelectors(page);
    result.selectorProbes = probes;
    const missingRequired = probes.filter((probe) => !probe.ok);
    if (missingRequired.length) {
      throw new Error(`Missing required Gmail selectors: ${missingRequired.map((p) => `${p.name} (${p.selector})`).join(", ")}`);
    }
    result.checks.push({ name: "required selectors present", ok: true });

    await verifyExtensionPalette(page);
    result.checks.push({ name: "command palette opens", ok: true });

    await verifySearchFocus(page);
    result.checks.push({ name: "search shortcut focuses Gmail search", ok: true });

    result.finishedAt = new Date().toISOString();
    result.ok = true;
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.finishedAt = new Date().toISOString();
    result.ok = false;
    result.error = error.message;
    const screenshotPath = path.join(ARTIFACT_DIR, `gmail-smoke-${Date.now()}.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      result.screenshot = screenshotPath;
    } catch {}
    console.error(JSON.stringify(result, null, 2));
    await context.close();
    process.exit(1);
  }

  await context.close();
}

if (mode === "setup") {
  setup().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (mode === "readonly") {
  readonly().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error(`Unknown smoke mode: ${mode}`);
  console.error("Usage: node smoke/gmail-readonly-smoke.js setup|readonly [--headed]");
  process.exit(1);
}
