# Inbox Keys

A Superhuman-style layer for Gmail, shipped as a zero-dependency Chrome extension (Manifest V3). It adds a Cmd+K command palette, keyboard shortcuts and chords, split-inbox tabs, fast account switching, a calendar key, and a unified-calendar layer on Google Calendar. No Gmail API, no server, no AI, no build step. The only permission requested is `storage` (plus `host_permissions` for `mail.google.com` and `calendar.google.com`). Everything works by driving Gmail's and Google Calendar's own UI from content scripts.

Current version: 0.5.0. Tests: 8 suites, all green (`cd extension && npm test`).

This file is the working guide for agents. `HANDOFF.md` has the longer narrative and the bug history; `README.md` is the user-facing overview. Read this before changing behavior.

## The one principle that explains most of the code

Gmail ignores synthetic input in two ways. Almost every past bug traces back to forgetting this:

1. Gmail's native keyboard router rejects synthetic key events (`isTrusted === false`). Dispatching a fake `j` or `r` does nothing. So we never send keystrokes to Gmail. We drive Gmail's real controls instead.
2. Many Gmail controls (role=tab side-rail items, toolbar icons, the reply-type caret) ignore a bare `element.click()`. They only react to a full pointer plus mouse gesture.

The fix used everywhere is `gmail.realClick(el)` in `gmail.js`, which dispatches the full sequence `pointerover, pointerdown, mousedown, pointerup, mouseup, click` at the element center. When something "does not respond to our click," the answer is almost always realClick plus the correct selector, not a synthetic key.

Corollary for navigation: drive Gmail's hash router directly (`location.hash = "#inbox"`, `#search/<query>`, etc.). That is the most stable hook Gmail exposes.

## Architecture

Chrome MV3. Content scripts share a single `window.InboxKeys` namespace and load in a fixed order (see `manifest.json` `content_scripts`):

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
src/content/gcal.js       CALENDAR driver (loads only on calendar.google.com). Own selector
                          registry, realClick, waitFor; drivers: calendars(), toggle/focusOnly/
                          showAll, addByUrl (Outlook/iCal), createEvent, today, view (radio +
                          dropdown fallback), period, accountEmail/accountIndex/switchAccount,
                          verifySelectors.
src/content/gcal-ui.js    in-calendar layer UI: Cmd+K overlay (toggle/focus layers, switch
                          account, add sources, mirror create/today/views) + curated single
                          keys (c/t/j/k/d/w/m) + persistent "keep adding accounts/feeds" nudge.
src/content/palette.css   scoped styles (palette, toasts, tab bar, config modal).
src/popup/                toolbar popup (quick toggles + configure tabs).
src/options/              settings page (toggles, per-command key remap UI, accounts, cheat sheet).
src/background/           MV3 service worker (message relay).
```

Where things live: keys and contexts are declared once in `keymap.js`; `commands.js` joins each catalog id to its `run()`. To add or change a binding you usually touch both. The palette is rebuilt every open so key overrides, tabs, and accounts stay current.

Isolated world caveat: content scripts run in the ISOLATED world, so `window.InboxKeys` is invisible to page main-world JS. Browser-automation tools and the devtools console default to the main world and will see `InboxKeys` as undefined. DOM and `location.hash` inspection are world-independent, so verify live state through those. In Chrome devtools you can switch the console context to the extension content script to reach `InboxKeys`.

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

Every load-bearing selector lives in ONE registry: `gmail.SEL` at the top of `gmail.js`. Code reads `SEL.*` (listnav, hotkeys, threadnav, tabs included); `verifySelectors()` probes the registry and is surfaced in the palette as "Verify Gmail selectors (smoke check)". When a shortcut dies in the field, run that command first: the failing probe names exactly which Gmail hook moved. The Playwright smoke (`npm run smoke:gmail:readonly`, see `SMOKE.md`) probes the same names from outside.

Hardening rules (audited Jun 2026, all enforced by tests):

- Failed actions toast. An action the user invoked must never silently eat the keystroke; `clickOr(el, what)` and `action()` toast "Gmail control not found: X" when the lookup fails. Exception: list paging stays silent at boundaries and in sectioned inboxes (deliberate, the pager is legitimately absent there).
- No synthetic-keyboard fallbacks anywhere. Gmail ignores synthetic keys, so such a fallback "succeeds" while doing nothing and masks breakage. `sendKey` was removed; the sim test pins its absence.
- `findControl` probes toolbars (`[gh="tm"]`, `[gh="mtb"]`, `[role="toolbar"]`) before the document-wide scan, because `controlLabel` falls back to textContent and a newsletter link whose text is exactly "Mute" used to get realClicked. Non-toolbar controls (Undo snackbar, Unsubscribe header button) are still reached by the fallback scan.
- Structural fallbacks for the two single points of failure: `listnav.rows()` falls back to `[gh="tl"] tr` rows carrying a `[role="checkbox"]` if `tr.zA` is renamed; `getContext` threadView falls back to `SEL.threadFallback` (card header / message body inside main) if `[data-message-id]` is renamed, still gated by `inThread()`.

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

Reply-all is the most fragile path and has regressed repeatedly. `replyAllToThread(scope)` is now deliberately simple, and crucially it does NOT open Gmail's response-type caret menu:

1. Click Gmail's inline "Reply all" button (`inlineReplyAll`: the bottom `.ams` link, or a labeled/exact "Reply all" / "Reply to all" button). Gmail renders it at the BOTTOM of the conversation whenever the thread has other recipients; clicking it opens the composer addressed to everyone in ONE step (verified live: a three-person thread opened with all three on it). Look in the focused card first, then fall back to the whole thread (document), because the inline controls live at the bottom OUTSIDE the message card listitem (`amsInsideLastCard` was empty live) and the per-message reply icon is hover-gated.
2. If there is no inline "Reply all" (a two-person thread), open a plain reply via `replyToThread` (same scope-then-document fallback). A plain reply already goes to the only other person, so it IS the reply-all. Done, no menu.

Why no caret menu: the old flow opened a reply, then clicked the reply-type caret `[aria-label="Type of response"]` to switch to "Reply to all". On a two-person thread (no reply-all) that menu opened pointlessly and sat over the compose box, conflicting with typing — the reported "very very weird" Enter behavior. Driving reply-all straight from the inline "Reply all" button avoids the menu entirely.

- Do NOT reintroduce the response-type caret menu, and do NOT try the per-message kebab. The kebab's aria-label varies across threads ("More message options" vs "More email options"), it is hover-gated, and it is easily confused with the conversation toolbar "More email options" menu, which has no reply-all item at all (Snooze / Add to Tasks / Forward all / Mute / …). Both were tried and reverted.
- Known tradeoff: if a multi-recipient thread ever fails to render an inline "Reply all", reply-all degrades to a plain reply rather than silently popping a menu. Live testing on current Gmail showed the inline button present whenever reply-all applied, so this is acceptable; if it ever regresses, detect recipient count rather than reopening the caret menu.

## The unified calendar layer (calendar.google.com)

A SECOND content script runs on `calendar.google.com` (its own `content_scripts` entry in `manifest.json`, gated by `host_permissions` for `https://calendar.google.com/*`). This is why the permission story changed from "storage only" to "storage + runs on Gmail and Google Calendar". Same engine philosophy as Gmail: never synthesize keys, drive the real control through a full pointer gesture (`gcal.realClick`), poll with `gcal.waitFor`, and keep every load-bearing selector in ONE registry (`gcal.SEL`) with a `verifySelectors()` smoke probe.

The merge itself is Google's own feature: cross-account calendars layer in via Google calendar sharing (real time) and external feeds via iCal subscription. The extension does NOT aggregate event data; it drives Calendar's UI and tracks nothing about your events. Its value is the in-calendar keyboard layer plus a persistent nudge that keeps prompting you to add more accounts and Outlook/iCal feeds.

Keyboard model: two surfaces, both in `gcal-ui.js`.

- Cmd+K overlay owns what Calendar has NO shortcut for: it lists add-a-source actions first (so "keep adding" is always on top), then "go to" account switches (`switchAccount(N)` to `/calendar/u/N/r`, labelled by email from the shared `accountNames` store), then per-calendar toggle/focus, show-all, and mirrored nav (today / day / week / month / create) so those work from the palette even with Calendar's own keys off. Adding an Outlook/iCal feed is fully automated and shows numbered Outlook publish steps; adding another Google account opens Calendar's own add menu plus guidance, since sharing must be granted from the other account.
- Curated single keys `c t j k d w m` (create, today, next/prev period, day/week/month). Unlike the Gmail side we DO bind these, but we capture them (capture-phase) and `consume` (preventDefault + stopImmediatePropagation), then drive Calendar's real control via `realClick`. So the action fires exactly once and is identical whether or not Calendar's native shortcuts are enabled, with no double-advance. Suppressed while typing (`isTyping`), while our overlay/input owns the keyboard, and for any modified/Shift chord. Keys Calendar has but we leave to it (n/p/y/a/g/x/r/s and `1`-`9`) are simply not in our map, so Calendar handles them natively.

`createEvent` clicks the main Create split-button, identified by its "Create" text ligature and the absence of an aria-label, explicitly excluding the "Create appointment schedule" lookalike. `view(label)` drives the view-switcher dropdown (there is NO segmented radio on current Calendar): it locates the `aria-haspopup="menu"` button whose label starts with a view name, opens it, and clicks the menu item whose text starts with the label. `period(dir)` matches `"Next/Previous " + view unit` and clicks the topmost (the mini-calendar renders a duplicate month-nav lower down).

Escape gotcha (verified live, traced June 2026): Calendar registers a window-level CAPTURE keydown handler before our content script, and for Escape with a text field focused it calls stopImmediatePropagation to blur the field, so our keydown handler never sees the first Escape (Cmd+K and other keys pass through fine; only Escape-while-typing is swallowed). Racing the event is impossible from a content script that loads later. The fix is `bindAutoClose`: close the overlay on `focusout` (the blur Calendar triggers moves focus out of our overlay, which we catch), giving a reliable single-press close. The keydown Escape branch stays as a backup for when focus is not in a text field.

Verified live selectors (Google Calendar, June 2026 — mirrored in `tests/gcal.test.js` fixtures):

```
[aria-label="My calendars"] / [aria-label="Other calendars"]   the rail lists (role=list)
  └ li[role="listitem"] > div[data-id] > input[type="checkbox"][aria-label="<calendar name>"]   a layer toggle
[aria-label="Add other calendars"]                             the + that opens the add menu
menuitem "From URL"                                            iCal subscribe (also: Subscribe to calendar, Import)
/calendar/u/N/r/settings/addbyurl                              the add-by-URL form route (SPA, no reload)
  └ the lone text input on the pane (NOT aria-label "Search for people") + button "Add calendar"
view switcher: button[aria-haspopup="menu"], label starts with view  ("Weekarrow_drop_down")
  └ menu items role="menuitem", text "<View><shortcut>" e.g. "MonthM"  matched by prefix
period nav: button[aria-label^="Next "|"Previous "] + view unit  ("Next week"/"Next month"…)
  └ a mini-calendar duplicate sits lower in the sidebar, so take the TOPMOST match
[aria-label^="Today"]                                          the Today button (aria includes the date)
[aria-label^="Google Account:"]                                account switcher; email parsed from "(…)"
main Create button: text contains "Create", no aria-label     (NOT [aria-label="Create appointment schedule"])
/calendar/u/N/r                                                account index in the URL
```

Gotcha verified live: Google unmounts the rail calendar list (the `input[type="checkbox"]` rows vanish from the DOM) while the tab is backgrounded or mid-rerender, then remounts it. So `calendars()` can momentarily return empty; always `waitFor(() => gcal.calendars().length)` before relying on it (the nudge does). The settings form's URL field has no aria-label and the page also has a "Search for people" text input, so `addByUrl` picks the text input that is NOT "Search for people" and confirms the pane by route or the "subscribe to a calendar by its URL" heading before typing — never type an ICS URL into the people-search box.

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
- "Verify Gmail selectors (smoke check)" in the palette: probes the `gmail.SEL` registry for the current surface, toasts a pass/fail summary, details in the console. First diagnostic step for any "key does nothing" report.
- Failed actions toast "Gmail control not found: X" instead of silently eating the keystroke (paging excepted, see its caveat).
- List paging with Shift+N (next/older page) and Shift+P (previous/newer page) via `gmail.nextPage()`/`prevPage()`. Two pager flavors: All Mail / Sent / labels use the toolbar buttons `aria-label="Older"`/`"Newer"`; SEARCH RESULTS keep that toolbar in the DOM but HIDDEN and expose their own visible pager `aria-label="Next results"`/`"Previous results"`. `nextPage`/`prevPage` try Older/Newer first, then fall through to Next/Previous results (`exactButton` filters by visibility, so the hidden ones are skipped). After the page turns, `listnav.page(dir)` waits for the hash to gain/lose its `/pN` segment, then pins the new page to the TOP with the cursor on row one (Gmail otherwise leaves the scroll near the bottom). Engine-special-cased before the editable guard so it also works from search where Gmail keeps the search box focused. CAVEAT: a Priority ("Important first") / sectioned inbox has NO global pager (sections use "Show more messages", and `#inbox/p2` redirects back to `#inbox`), so paging is a harmless no-op in that view. Verified live Jun 2026: `#all` → `#all/p2`, `#label/<x>` → `/p2`, `#search/<q>` → `/p2` (the last via "Next results").

## Pending work

### 1. Split-inbox MVP polish (planned, not yet done)

Most plumbing already exists in `tabs.js` (bar, hash navigation, active detection, config modal, persistence, Tab/Shift+Tab cycling). The agreed default tabs are NOT yet seeded; `storage.js` still ships `Inbox / Unread / Starred`. Remaining tasks:

- Swap `DEFAULTS.tabs` in `storage.js` to the agreed three: Inbox (`type: inbox`), "Important and Starred" (`is:important OR is:starred`), and "Other" (`in:inbox -is:important -is:starred`). Everything past those three, users build themselves through the gear.
- Add a "Reset to defaults" button in the config modal.
- Add `[` and `]` as cycle keys alongside Tab and Shift+Tab (add to `keymap.js` and the engine).
- Light save validation in the config modal: drop empty rows (done), dedupe, soft cap around seven with a hint.
- Verify the "Other" catch-all query live so it truly equals inbox minus the splits.
- The AI Auto-Label layer stays a later phase; it needs a model and a backend, so it is out of scope for this DOM-only, no-backend MVP.

### 2. Live smoke test (done, two layers)

In-Gmail: the palette command "Verify Gmail selectors (smoke check)" runs `gmail.verifySelectors()` over the selector registry and toasts what is missing on the current surface. Outside: `npm run smoke:gmail:readonly` (Playwright, see `SMOKE.md`) probes the same names against real Gmail with a logged-in test profile. Both catch Gmail-side DOM renames the jsdom fixtures cannot.

### 3. Rename to Inbox Keys (done)

The product is Inbox Keys everywhere (was Open Superhuman; before that the internal namespace was a `CMDK` carryover). Current state: namespace `window.InboxKeys`, keymap global `InboxKeys_KEYMAP`, CSS prefix `inboxkeys-` (e.g. `inboxkeys-tab`, `inboxkeys-overlay`, `inboxkeys-cursor`), runtime message types `inboxkeys:...`, npm package `inboxkeys`, manifest name "Inbox Keys: Gmail command palette, hotkeys, split inbox & calendar". Done as one mechanical pass with `npm test` green. The repo directory is still `open-superhuman/` (renaming it is a user-side move; it breaks open editor sessions and remotes). The user-facing `Cmd+K` / `⌘K` shortcut text is the actual keystroke, not a brand name.

## Conventions

- No dashes or em-dashes as punctuation in prose.
- Concise over thorough. Direct answers over caveats.
- Real behavior over mocks in tests. Root-cause fixes over workarounds.
- Never add Claude as a co-author on commits or PRs.
- When in doubt about a Gmail interaction, drive the real control with realClick and the correct selector. Do not fight Gmail with synthetic keys.
