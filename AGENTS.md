# Open Superhuman

A Superhuman-style layer for Gmail, shipped as a zero-dependency Chrome extension (Manifest V3). It adds a Cmd+K command palette, keyboard shortcuts and chords, split-inbox tabs, fast account switching, and a calendar key. No Gmail API, no server, no AI, no build step. The only permission requested is `storage` (plus `host_permissions` for `mail.google.com`). Everything works by driving Gmail's own UI from a content script.

Current version: 0.3.5. Tests: 4 suites, all green (`cd extension && npm test`).

This file is the working guide for agents. `HANDOFF.md` has the longer narrative and the bug history; `README.md` is the user-facing overview. Read this before changing behavior.

## The one principle that explains most of the code

Gmail ignores synthetic input in two ways. Almost every past bug traces back to forgetting this:

1. Gmail's native keyboard router rejects synthetic key events (`isTrusted === false`). Dispatching a fake `j` or `r` does nothing. So we never send keystrokes to Gmail. We drive Gmail's real controls instead.
2. Many Gmail controls (role=tab side-rail items, toolbar icons, the reply-type caret) ignore a bare `element.click()`. They only react to a full pointer plus mouse gesture.

The fix used everywhere is `gmail.realClick(el)` in `gmail.js`, which dispatches the full sequence `pointerover, pointerdown, mousedown, pointerup, mouseup, click` at the element center. When something "does not respond to our click," the answer is almost always realClick plus the correct selector, not a synthetic key.

Corollary for navigation: drive Gmail's hash router directly (`location.hash = "#inbox"`, `#search/<query>`, etc.). That is the most stable hook Gmail exposes.

## Architecture

Chrome MV3. Content scripts share a single `window.CMDK` namespace and load in a fixed order (see `manifest.json` `content_scripts`):

```
src/shared/hashutil.js    pure hash helpers (thread detection, parent hash). Unit-tested in Node.
src/shared/keymap.js      command catalog: ids, titles, default keys, contexts, fixed flag.
                          Loaded both as first content script AND by options.html.
src/content/storage.js    chrome.storage wrapper + DEFAULTS (tabs, toggles, keyOverrides).
src/content/toast.js      small toast UI.
src/content/gmail.js      THE CORE. realClick, getContext, inThread, setHash, reply/replyAll/
                          forward, archive, back, compose, action(), waitFor poll helper, list scroll.
src/content/accounts.js   g+digit account switching (/mail/u/N), accounts config modal.
src/content/calendar.js   the 0 / 0 0 calendar key.
src/content/listnav.js    keyboard cursor + multi-select over list rows (tr.zA). Shift range select.
src/content/threadnav.js  cursor over message cards in an open conversation; expand/collapse.
src/content/tabs.js       split-inbox tab bar (each tab = a saved Gmail search), config modal.
src/content/commands.js   command registry: single source of truth for palette + hotkeys.
src/content/palette.js    the Cmd+K overlay UI.
src/content/hotkeys.js    the keyboard engine: capture-phase keydown, context gating, consume().
src/content/content.js    bootstrap.
src/content/palette.css   scoped styles (palette, toasts, tab bar, config modal).
src/popup/                toolbar popup (quick toggles + configure tabs).
src/options/              settings page (toggles, per-command key remap UI, accounts, cheat sheet).
src/background/           MV3 service worker (message relay).
```

Where things live: keys and contexts are declared once in `keymap.js`; `commands.js` joins each catalog id to its `run()`. To add or change a binding you usually touch both. The palette is rebuilt every open so key overrides, tabs, and accounts stay current.

Isolated world caveat: content scripts run in the ISOLATED world, so `window.CMDK` is invisible to page main-world JS. Browser-automation tools and the devtools console default to the main world and will see `CMDK` as undefined. DOM and `location.hash` inspection are world-independent, so verify live state through those. In Chrome devtools you can switch the console context to the extension content script to reach `CMDK`.

## The context classifier (gmail.getContext)

The keyboard engine gates every shortcut by the current Gmail context so a binding fires only where it makes sense. `getContext()` returns one value in strict priority order:

```
paletteOpen > modalOpen > compose > threadView > inboxList > searchFocused > unknown
```

Two subtleties that caused regressions:

- `threadView` requires both `inThread()` true AND a rendered message in the DOM, and is checked before `searchFocused`. After a Gmail search, Gmail often leaves focus in the search input even while you read a thread, so a stale focused box must not win.
- An inline reply inside a thread is intentionally classified `threadView`, not `compose`, so message navigation keeps working. Reply exit is handled separately via `gmail.hasOpenThreadReply()`.

The engine uses a capture-phase keydown listener and `consume(e)` (preventDefault plus stopImmediatePropagation) to claim a key so Gmail never double-handles it. `isEditable(target)` must guard non-Element targets, because a keydown target can be the `document` (no `getAttribute`), which once crashed the handler.

## Hash routing (hashutil.js)

Gmail routes everything through the URL hash. The conversation id is always the LAST slash-separated segment, no matter how many list/query/label segments precede it:

```
#inbox                        list
#search/<query>               search results list
#label/<name>                 label list
#inbox/<thread-id>            conversation opened from inbox
#search/<query>/<thread-id>   conversation opened from search
#label/<name>/<thread-id>     conversation opened from a label
```

`hashIsThread(hash)` checks whether the last segment looks like a thread id (a long `[A-Za-z0-9_-]` token, floor 20 chars; real ids are around 32). The floor is low on purpose so a real id is never missed; a rare long single-word query can match by shape, but `getContext` also requires a rendered message, so it never produces a false `threadView`. `parentHash(hash)` strips the trailing thread id. Both are pure and fully unit-tested.

## Fragile areas and the real Gmail selectors

These selectors were verified live in Chrome and are mirrored in the test fixtures on purpose. If Gmail changes its DOM, recheck these first.

```
tr.zA                              a list row
[role="checkbox"]                  per-row select control
[gh="tl"]                          the thread list area
[data-message-id]                  a rendered message in a thread
[role="listitem"] + .gE            a message card and its header
.a3s                               a message body
.ams (classes bkH, bkG)            inline action links: "Reply", "Forward"
[aria-label="Type of response"]    the open reply's reply-type caret
[role="menuitem"] / .J-N           menu items (plain text, no aria-label)
[gh="cm"]                          compose button
[gh="tm"]                          toolbar
input[aria-label="Search mail"], input[name="q"]   the search box
```

Reply-all is the most fragile path and has regressed repeatedly:

- Real Gmail often has NO inline reply-all button. The inline `.ams` links are frequently only "Reply" and "Forward".
- Reply-all lives behind the open reply's reply-type caret `[aria-label="Type of response"]`. Clicking it opens a menu of plain-text `[role="menuitem"]` items like "Reply to all". The caret can render just outside the compose surface, so it is looked up document-wide (a thread has at most one open reply).
- Gmail renders the reply surface and that menu asynchronously. Use `gmail.waitFor(find, onFound, onGiveUp)`, which polls; its first probe is synchronous, so when the DOM already exists the whole chain completes without timers. The old bug was fixed `setTimeout`s that fired before the caret existed and silently gave up. Keep the waitFor pattern.
- Some messages genuinely offer no reply-all (a forward, or you are the only other recipient). Then the single reply already is the reply-all; the code closes the menu and stops. That is not a bug.

## Develop and test

No build step. Edit a file, click the refresh icon on the extension card at `chrome://extensions`, then reload Gmail.

Load unpacked: `chrome://extensions` to Developer mode on to Load unpacked to select the `extension` folder. For smoothest hotkeys, turn on Gmail's own shortcuts (Gmail Settings, Keyboard shortcuts on).

Tests run from `extension/`:

```
npm install   # once; installs jsdom (dev dependency, node_modules is gitignored)
npm test
```

The suite is plain `node:assert` scripts, no framework. Four files:

- `tests/hashutil.test.js` pure unit tests of the hash logic across every hash shape.
- `tests/getcontext.test.js` loads real `gmail.js` into jsdom and asserts `getContext` for every state, including a thread opened from search.
- `tests/hotkeys.test.js` the integration suite. Loads ALL content scripts into jsdom via `helpers.tryLoadContentScripts`, dispatches real keydown events, and asserts real outcomes (cursor moved, row archived, reply-all reached, palette opened). This is where regressions get caught.
- `tests/key-behavior-sim.test.js` pure logic re-implementations plus source greps that pin selector strings and guard against known bad patterns.

Test rules:

- Test the fragile DOM-driving logic against fixtures that use the real verified selectors above. A fixture that mimics Gmail's actual reply flow beats a logic-only test.
- Keep fixtures synchronous. jsdom dispatchEvent is synchronous and `waitFor` probes synchronously first, so the whole click chain resolves without timers; tests stay fast and deterministic.
- `helpers.js` provides `tryLoad` (gmail only) and `tryLoadContentScripts` (full stack). Both return null if jsdom is missing, so the suite skips rather than hard-fails on a clean clone. The helper stubs `chrome`, overrides `getBoundingClientRect` so `isVisible` works, and stubs `scrollIntoView`.
- When you fix a bug, add the failing scenario as a test in the same commit.

Known gap: fixtures encode Gmail's current DOM. If Gmail renames a selector, tests stay green while production breaks, because jsdom cannot see real Gmail. Source-grep tests pin the selector strings so an accidental code change fails, but a Gmail-side rename is only caught by a periodic live smoke test, which does not exist yet (see pending work).

Live-testing safety: when testing against real Gmail, take no destructive actions on real mail (no archiving, deleting, sending, or discarding a non-empty draft). Read-only DOM inspection and opening an empty reply are fine.

## What works today (0.3.5)

- Cmd+K command palette, fuzzy search over all actions.
- Hotkeys and g-prefixed chords (g i inbox, g t sent, g d drafts, g a all mail, g h snoozed, etc.).
- Per-command key remapping via the options page (`keyOverrides` in storage); engine-special-cased keys are shown read-only.
- Account switching g0 through g8 to /mail/u/N, plus palette entries by email (emails fill in as you visit each account).
- Calendar key: 0 opens a half-window calendar, 0 0 opens a new tab.
- Split-inbox tab bar with a gear config modal. Each tab is a saved Gmail search driving the hash router. Tab and Shift+Tab cycle the tabs. Add/rename/remove, suggestion chips, persistence.
- List cursor and multi-select over rows. Shift+Arrow is an anchor-based range (Shift+Down grows, Shift+Up shrinks and deselects the row it leaves).
- Thread message navigation with j/k across message cards. Enter reply-alls. Escape exits an open reply first, then a second Escape goes back to the list. The colon key expands or collapses all messages.

## Pending work

### 1. Split-inbox MVP polish (planned, not yet done)

Most plumbing already exists in `tabs.js` (bar, hash navigation, active detection, config modal, persistence, Tab/Shift+Tab cycling). The agreed default tabs are NOT yet seeded; `storage.js` still ships `Inbox / Unread / Starred`. Remaining tasks:

- Swap `DEFAULTS.tabs` in `storage.js` to the agreed three: Inbox (`type: inbox`), "Important and Starred" (`is:important OR is:starred`), and "Other" (`in:inbox -is:important -is:starred`). Everything past those three, users build themselves through the gear.
- Add a "Reset to defaults" button in the config modal.
- Add `[` and `]` as cycle keys alongside Tab and Shift+Tab (add to `keymap.js` and the engine).
- Light save validation in the config modal: drop empty rows (done), dedupe, soft cap around seven with a hint.
- Verify the "Other" catch-all query live so it truly equals inbox minus the splits.
- The AI Auto-Label layer stays a later phase; it needs a model and a backend, so it is out of scope for this DOM-only, no-backend MVP.

### 2. Live smoke test

A periodic real-Gmail smoke test would catch Gmail-side DOM renames that the jsdom fixtures cannot. Good future task.

### 3. Optional internal rename

User-facing name is Open Superhuman, but the internal namespace is still `window.CMDK` and CSS classes use a `cmdk-` prefix (`cmdk-tab`, `cmdk-overlay`, `cmdk-cursor`). Left as-is because they are implementation details and renaming touches every file plus tests. If done, do it as one mechanical pass with `npm test` as the safety net; note `cmdk-cursor` and a few class strings are asserted in tests, so update those too.

## Conventions

- No dashes or em-dashes as punctuation in prose.
- Concise over thorough. Direct answers over caveats.
- Real behavior over mocks in tests. Root-cause fixes over workarounds.
- Never add Claude as a co-author on commits or PRs.
- When in doubt about a Gmail interaction, drive the real control with realClick and the correct selector. Do not fight Gmail with synthetic keys.
