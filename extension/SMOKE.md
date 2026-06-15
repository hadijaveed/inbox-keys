# Gmail Read-Only Smoke Test

This smoke test checks whether Gmail still exposes the DOM surfaces Inbox Keys depends on. It uses a persistent local Chrome profile so you log into Gmail manually once. The script never asks for, reads, or stores Gmail credentials.

## One-Time Install

```bash
cd extension
npm run smoke:install
```

## One-Time Login Setup

Use a dedicated Gmail test account, not a primary inbox.

The read-only probe expects at least one visible inbox conversation row. Send the account a harmless email before running the smoke test.

```bash
cd extension
npm run smoke:gmail:setup
```

Chrome opens with the unpacked extension loaded. Log into Gmail manually in that browser, leave it on the inbox, then press Enter in the terminal. The authenticated session is stored in:

```text
extension/.smoke/chrome-profile
```

That directory is gitignored.

## Run The Read-Only Smoke

```bash
cd extension
npm run smoke:gmail:readonly
```

The smoke test verifies:

- Gmail is logged in.
- Required Gmail selectors are present.
- The Inbox Keys command palette opens with Cmd/Ctrl+K.
- `/` focuses Gmail search.

It does not archive, trash, send, label, snooze, mute, mark read/unread, open a thread, discard drafts, or otherwise mutate the mailbox.

## Useful Environment Variables

```bash
INBOXKEYS_SMOKE_PROFILE=/path/to/profile npm run smoke:gmail:readonly
INBOXKEYS_SMOKE_URL=https://mail.google.com/mail/u/0/#inbox npm run smoke:gmail:readonly
INBOXKEYS_CHROME_CHANNEL=chrome npm run smoke:gmail:readonly
```

Use `INBOXKEYS_CHROME_CHANNEL=chrome` if Playwright's bundled Chromium is not installed but local Chrome is available.

## Reading Failures

Failures are printed as JSON. If a selector is missing, the output names the selector and writes a screenshot under:

```text
extension/.smoke/artifacts
```

Missing required selectors usually means Gmail DOM drifted and the selectors in `src/content/gmail.js`, `src/content/listnav.js`, or `src/content/threadnav.js` need to be rechecked against live Gmail.
