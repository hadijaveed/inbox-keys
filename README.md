# Inbox Keys

Superhuman-speed Gmail, without giving anyone your email.

<p align="center">
  <a href="https://www.youtube.com/watch?v=oyiEgL7-68s">
    <img src="https://img.youtube.com/vi/oyiEgL7-68s/maxresdefault.jpg" alt="Watch the Inbox Keys demo" width="640">
  </a>
  <br>
  <a href="https://www.youtube.com/watch?v=oyiEgL7-68s"><b>▶ Watch the demo</b></a>
</p>

Inbox Keys is a **Cmd+K command palette**, **keyboard shortcuts**, **split-inbox tabs**, **fast account switching**, and a **calendar key** for Gmail, shipped as a zero-dependency Chrome extension (Manifest V3).

> **The privacy stance is the whole point.** No Gmail API. No server. No AI. No analytics. No build step. The only permission is `storage` (your settings, kept locally). Everything works by driving Gmail's own UI from a content script, so Inbox Keys never reads, sends, or stores your mail.

## Features

- **Command palette (`Cmd/Ctrl+K`)**: fuzzy-search every action: compose, triage, jump to any folder, tab, or account, run anything.
- **Hotkeys and chords**: `c` compose, `e` archive, `r` reply, `Enter` reply-all, `f` forward, `s` star, `h` snooze, `x` select, `/` search, plus `g`-chords (`g i` inbox, `g t` sent, `g d` drafts, `g a` all mail, `g h` snoozed).
- **Remappable keys**: every non-engine shortcut can be rebound from the settings page or the in-Gmail config modal. Collisions are detected; built-ins show read-only.
- **Split-inbox tabs**: a tab bar over Gmail where each tab is any Gmail search (`in:inbox is:unread`, `label:Clients`, `from:boss@x.com`, `category:updates`). `Tab`/`Shift+Tab` cycle. One-click preset suggestions, gear modal to edit. Gmail renders the lists itself via its own hash router.
- **List navigation**: keyboard cursor over the thread list, `j`/`k` movement, `x` multi-select, anchor-based `Shift+Arrow` range select, `Shift+N`/`Shift+P` paging that lands you at the top of the new page, `g g`/`Shift+G` top and bottom.
- **Thread navigation**: `j`/`k` between conversations, arrows across message cards, `o` expand/collapse, `:` expand all, `Enter` reply-all, `Escape` exits a reply first, then returns to the list with your cursor and scroll position restored.
- **Account switching**: `g 0` through `g 8` jump straight to `/mail/u/N/`. The palette lists accounts by email as it learns them.
- **Calendar key**: `0` opens Google Calendar beside Gmail, `0 0` opens it in a new tab, always for the account you are in.

## Install

### From source (2 minutes, works today)

1. Clone this repo.
2. Open `chrome://extensions` in any Chromium browser (Chrome, Edge, Brave, Arc).
3. Toggle **Developer mode** on.
4. Click **Load unpacked** and select the `extension/` folder.
5. Open [Gmail](https://mail.google.com) and hit `Cmd/Ctrl+K`.

For the smoothest behavior, turn Gmail's own shortcuts on: Gmail Settings, See all settings, Keyboard shortcuts on.

### Chrome Web Store

Submission in progress. This README will link the listing once it is live.

## Why it does not break (much)

Gmail's DOM is undocumented and shifts under every extension that touches it. Inbox Keys is engineered around that:

- **Hash routing first.** Navigation, tabs, and account switching ride Gmail's own URL router, the most stable hook Gmail exposes. Those features survive any redesign.
- **One selector registry.** Every load-bearing DOM hook lives in `gmail.SEL`. The palette command **"Verify Gmail selectors (smoke check)"** probes the registry live and names exactly what moved if Gmail changes.
- **Loud failures.** If a control goes missing, you get a toast naming it, never a silently eaten keystroke.
- **Structural fallbacks.** The two most load-bearing selectors (`tr.zA` rows, `[data-message-id]` messages) have shape-based fallbacks, so a Gmail class rename degrades gracefully instead of killing navigation.
- **Real tests.** Six jsdom suites dispatch real keydown events against fixtures using verified Gmail selectors, plus a Playwright smoke test against live Gmail (`npm run smoke:gmail:readonly`).

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
npm test           # 6 suites: unit, context classifier, full keyboard integration
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
