# Open Superhuman

An open-source, Superhuman-style layer for Gmail: a **Cmd+K command palette**,
**keyboard shortcuts**, **split-inbox tabs**, **fast account switching**, and a
**calendar key** — as a zero-dependency Chrome extension (Manifest V3).

> This does **not** use the Gmail API and asks for **no read/write access to
> your email**. It drives Gmail's own UI from a content script, so the only
> permission it needs is `storage`.

## Features

- **Command palette (`Cmd/Ctrl + K`)** — fuzzy-search every action: compose,
  triage, jump to any folder or tab, switch accounts, run anything.
- **Superhuman-style hotkeys** — `c` compose, `e` archive, `r`/`a`/`f`
  reply/reply-all/forward, `s` star, `h` snooze, `/` search, and `g`-prefixed
  chords (`g i` inbox, `g t` sent, `g d` drafts, `g a` all mail, `g h` snoozed…).
- **Split-inbox tabs** — a tab bar at the top of Gmail where each tab is any
  Gmail search (`is:unread`, `label:Clients`, `from:boss@x.com`, `has:attachment`,
  `category:updates`…). Edit them from the gear in the bar; one-click suggestions
  included. Tabs drive Gmail's own hash router, so the list is rendered by Gmail.
- **Account switching** — `g 0`, `g 1`, `g 2`… jump straight to `/mail/u/N/`.
  The number is the account index. Also available from the palette by email.
- **Calendar key** — at the top level (not while reading a thread): `0` opens
  Google Calendar in a half-screen window beside Gmail; `0 0` opens it in a new
  tab. Opens for the account you're currently in.

## Install (Load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser: Edge, Brave, Arc).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select the `open-superhuman/extension` folder.
4. Open [Gmail](https://mail.google.com) and hit **`Cmd/Ctrl + K`**.

No build step. Edit a file, hit the refresh icon on the extension card, reload Gmail.

For the smoothest hotkey behavior, turn on Gmail's own shortcuts:
**Gmail → Settings → See all settings → Keyboard shortcuts on**.

## How it works

```
extension/
  manifest.json            MV3 manifest (only the "storage" permission)
  src/content/             injected into mail.google.com
    storage.js             chrome.storage wrapper + defaults
    gmail.js               drive Gmail: hash routing, toolbar clicks, compose DOM
    accounts.js            detect + switch /mail/u/N accounts
    calendar.js            open Google Calendar (half-window / new tab)
    tabs.js                split-inbox tab bar + gear config modal
    commands.js            the command registry (palette + hotkey source of truth)
    palette.js             the Cmd+K overlay UI
    hotkeys.js             key + chord engine
    content.js             bootstrap
    palette.css            scoped styles (palette, toasts, tab bar, config modal)
  src/popup/               toolbar popup (quick toggles + configure tabs)
  src/options/             settings: hotkey, tabs, accounts, shortcuts cheat sheet
  src/background/          MV3 service worker (message relay)
```

Design notes:

- **Navigation** and **split-inbox tabs** use Gmail's hash router (`#inbox`,
  `#sent`, `#search/…`) — the most stable hook there is.
- **Compose** clicks Gmail's stable `[gh="cm"]` button.
- **Triage actions** click toolbar buttons by tooltip/aria-label, falling back to
  Gmail's native key shortcut. Because these depend on Gmail's DOM, they're the
  most likely thing to need a tweak after a Gmail redesign — they're isolated in
  `gmail.js` and `commands.js`.
- The **tab bar** re-injects itself as Gmail re-renders (a `MutationObserver` on
  the main area).

## Limitations & honesty

- Gmail's DOM is undocumented and changes; toolbar-driven actions and the tab
  bar's injection point may need updates over time.
- Localized Gmail UIs may need the English tooltip strings in `gmail.js` /
  `commands.js` translated.
- The half-screen calendar opens a pop-up window; allow pop-ups for
  `mail.google.com` if your browser blocks it.

## Roadmap ideas

- Per-command remappable keys, mode-aware hotkeys, and a `?` shortcuts overlay.
- Tab recommendations learned from your usage.
- Firefox (MV3) packaging.

## License

MIT — see [LICENSE](LICENSE).
