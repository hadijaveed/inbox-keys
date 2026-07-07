# Inbox Keys

Superhuman-speed Gmail, without giving anyone your email.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/inbox-keys-gmail-command/bfcdnkjplofjddlecpojhpoomdialafa"><b>⬇ Install from the Chrome Web Store</b></a>
  &nbsp;·&nbsp;
  <a href="https://www.youtube.com/watch?v=oyiEgL7-68s"><b>▶ Watch the demo</b></a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=oyiEgL7-68s">
    <img src="https://img.youtube.com/vi/oyiEgL7-68s/maxresdefault.jpg" alt="Watch the Inbox Keys demo" width="640">
  </a>
</p>

Inbox Keys is a **Cmd+K command palette**, **keyboard shortcuts**, **split-inbox tabs**, **fast account switching**, and a **unified calendar layer** for Gmail and Google Calendar, shipped as a zero-dependency Chrome extension (Manifest V3). Install it, press `Cmd+K` in Gmail, and every action is a keystroke away.

## Why you'd want this

Superhuman costs $30/month and works by reading your entire mailbox through the Gmail API on their servers. Inbox Keys gives you the part that actually makes you fast, the keyboard-first workflow, for free, with a design that makes reading your mail impossible:

- **No Gmail API.** It never authenticates against your mail. There is no OAuth screen because there is nothing to grant.
- **No server, no analytics, no AI.** Nothing leaves your browser. There is no backend to trust because there is no backend.
- **One permission: `storage`.** That's your settings, kept locally, plus host access so the content scripts can run on Gmail and Calendar. You can verify this in `manifest.json` in about ten seconds.
- **No build step, no dependencies.** The code that runs is the code in this repo. Auditing the whole extension is an afternoon, not a project.

Everything works by driving Google's own UI from content scripts: the same buttons you would click, clicked faster. Inbox Keys never reads, sends, or stores your mail or calendar events.

## Features

- **Command palette (`Cmd/Ctrl+K`)**: fuzzy-search every action: compose, triage, jump to any folder, tab, or account, run anything.
- **Hotkeys and chords**: `c` compose, `e` archive, `r` reply, `Enter` reply-all, `f` forward, `s` star, `h` snooze, `x` select, `/` search, plus `g`-chords (`g i` inbox, `g t` sent, `g d` drafts, `g a` all mail, `g h` snoozed).
- **Remappable keys**: every non-engine shortcut can be rebound from the settings page or the in-Gmail config modal. Collisions are detected; built-ins show read-only.
- **Split-inbox tabs**: a tab bar over Gmail where each tab is any Gmail search (`in:inbox is:unread`, `label:Clients`, `from:boss@x.com`, `category:updates`). `Tab`/`Shift+Tab` cycle. One-click preset suggestions, gear modal to edit. Gmail renders the lists itself via its own hash router.
- **List navigation**: keyboard cursor over the thread list, `j`/`k` movement, `x` multi-select, anchor-based `Shift+Arrow` range select, `Shift+N`/`Shift+P` paging that lands you at the top of the new page, `g g`/`Shift+G` top and bottom.
- **Thread navigation**: `j`/`k` between conversations, arrows across message cards, `o` expand/collapse, `:` expand all, `Enter` reply-all, `Escape` exits a reply first, then returns to the list with your cursor and scroll position restored.
- **Account switching**: `g 0` through `g 8` jump straight to `/mail/u/N/`. Every signed-in account shows up in the palette by email, auto-detected, no setup.
- **Calendar key**: `0` opens Google Calendar beside Gmail, `0 0` opens it in a new tab, always for the account you are in.
- **Unified calendar layer**: on Google Calendar, `Cmd/Ctrl+K` opens a layer palette to toggle or focus any calendar, switch accounts, and add more sources, plus single keys (`c` create, `t` today, `←`/`→` (or `j`/`k`) previous/next, `d`/`w`/`m` day/week/month). Two simple add flows pull everything into one view: to add another Google account's calendar, Inbox Keys opens Calendar's own "Subscribe to calendar" pane in a new tab and keeps a short guide open with a Refresh button; to add an Outlook/iCal calendar, paste its published `.ics` link. The merge is Google's own (calendar subscription and sharing); Inbox Keys just drives the UI and reads no event data.

## Install

### Chrome Web Store (recommended)

**[Install Inbox Keys](https://chromewebstore.google.com/detail/inbox-keys-gmail-command/bfcdnkjplofjddlecpojhpoomdialafa)**, then open [Gmail](https://mail.google.com) and hit `Cmd/Ctrl+K`.

Works in any Chromium browser (Chrome, Edge, Brave, Arc). For the smoothest behavior, turn Gmail's own shortcuts on: Gmail Settings, See all settings, Keyboard shortcuts on.

### From source (2 minutes)

1. Clone this repo.
2. Open `chrome://extensions`, toggle **Developer mode** on.
3. Click **Load unpacked** and select the `extension/` folder.

Same code as the store build; there is no build step to diverge.

## For developers: why this repo is worth reading

Gmail's DOM is undocumented, minified, and shifts under every extension that touches it. Google also actively ignores synthetic input: dispatching a fake `j` keydown does nothing, and many controls reject a bare `.click()`. Building something reliable on top of that is the actual engineering here, and the patterns transfer to automating any hostile web UI:

- **Never synthesize keystrokes.** Gmail's keyboard router drops untrusted events. Every action drives a real Gmail control through a full pointer gesture (`pointerover → pointerdown → mousedown → pointerup → mouseup → click`), see `gmail.realClick`.
- **Hash routing first.** Navigation, tabs, and account switching ride Gmail's own URL router (`#inbox`, `#search/<query>`, `/mail/u/N/`), the most stable hook Gmail exposes. Those features survive any redesign.
- **One selector registry.** Every load-bearing DOM hook lives in `gmail.SEL` (and `gcal.SEL` for Calendar). The palette command **"Verify Gmail selectors (smoke check)"** probes the registry live and names exactly what moved if Gmail changes.
- **A context classifier gates every key.** `getContext()` resolves palette > modal > compose > thread > list > search, so shortcuts only fire where they make sense and never steal your typing.
- **Loud failures.** If a control goes missing, you get a toast naming it, never a silently eaten keystroke.
- **Structural fallbacks.** The two most load-bearing selectors (`tr.zA` rows, `[data-message-id]` messages) have shape-based fallbacks, so a Gmail class rename degrades gracefully instead of killing navigation.
- **Real tests.** Nine jsdom suites dispatch real keydown events against fixtures built from verified Gmail selectors, plus a Playwright smoke test against live Gmail (`npm run smoke:gmail:readonly`).
- **Reading a page-world global from a content script.** Account enumeration finds the signed-in account list inside Gmail's minified `window.gbar` by crawling for the *shape* of the data (an array of objects that each own an email string) rather than key names that change every build, then hands it across the world boundary with a validated `postMessage`. See `src/content/account-bridge.js`.

## How it works

```
extension/
  manifest.json            MV3 manifest (only the "storage" permission)
  src/shared/              hash helpers + the shortcut catalog (shared with options)
  src/content/
    gmail.js               the core: selector registry, realClick, context classifier
    listnav.js             list cursor, multi-select, paging, position restore
    threadnav.js           message-card cursor inside a conversation
    tabs.js                split-inbox tab bar + config modal
    commands.js            command registry (single source for palette + hotkeys)
    palette.js / hotkeys.js  the Cmd+K overlay and the key/chord engine
    account-bridge.js      MAIN-world reader for the signed-in account list
    gcal.js / gcal-ui.js   the Google Calendar driver and its palette + keys
  src/popup/  src/options/  toolbar popup and the settings page
  src/background/          MV3 service worker (message relay)
```

Two principles explain most of the code:

1. Gmail ignores synthetic keyboard events, so Inbox Keys never fakes keystrokes. Every action drives a real Gmail control through a full pointer gesture (`gmail.realClick`).
2. A context classifier (`getContext()`) gates every shortcut (palette, modal, compose, thread, list, search), so keys only fire where they make sense and never steal your typing.

## Develop and test

No build step. Edit a file, refresh the extension card, reload Gmail.

```bash
cd extension
npm install        # jsdom, dev only
npm test           # 9 suites: unit, context classifier, full keyboard integration
```

Read `CLAUDE.md` for the working guide (architecture, fragile areas, conventions) and `extension/SMOKE.md` for the live smoke test setup.

## Limitations

- English Gmail UIs only for label-matched actions today. Navigation works in any locale; translating the label strings in `gmail.js` is a welcome contribution.
- Gmail redesigns can still move things. The verify command and the smoke test exist to make those one-minute fixes instead of mysteries.
- The half-screen calendar needs pop-ups allowed for `mail.google.com`.

## Roadmap

- Default split-inbox preset (Inbox / Important and Starred / Other) with `[` `]` cycling.
- Localized label matching.
- Firefox (MV3) packaging.

## License

MIT, see [LICENSE](LICENSE).
