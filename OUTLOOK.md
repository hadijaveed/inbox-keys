# Supporting Outlook / Microsoft email in Inbox Keys

## The honest framing first

Superhuman is a standalone email client. It connects to each mailbox through provider APIs under OAuth (Gmail API for Google, Microsoft Graph for Microsoft 365) and runs its own backend that syncs, caches, and indexes mail server side. That backend is what makes its speed, instant search, scheduling, and AI possible.

Inbox Keys is the opposite by design. It is a content script that drives Gmail's and Google Calendar's own web UI from the isolated world. No mail API, no OAuth token, no backend, no index. It touches no mail data and asks for one permission (`storage`) plus host permissions for the two Google surfaces.

What that means for "manage Outlook like Superhuman lets you":

- A DOM layer cannot merge a Gmail inbox and an Outlook inbox into one stream. It cannot do unified cross provider search, render cross provider snippets, or schedule across providers. All of that requires fetching and persisting mail from both APIs into a server side index. That is a backend product, which is a different thing from what Inbox Keys is.
- Worth saying out loud: even Superhuman, with the full backend and both APIs, does NOT offer a true merged inbox. Its own help docs call it a "Unified Inbox Workaround" and tell you to use per account tabs and Ctrl/Cmd+1..N switching. So the realistic ceiling for ANY tool here is fast per account switching plus a consistent keyboard layer, not one fused stream.

So "Superhuman-style" in our world can mean: the same Cmd+K palette, the same chords, the same fast switching, applied to Outlook on the web in its own tab. It cannot mean one inbox that contains both providers' mail.

If the colleague's actual requirement is a real merged inbox, the honest answer is that an existing multi provider desktop client (Thunderbird, Mailspring, or similar) already does that today, and no DOM layer on Gmail can. That is outside Inbox Keys' scope, but it is the correct pointer for a true unified inbox.

The rest of this doc splits cleanly into two tracks.

---

## Track A: what the colleague can do today, zero code

Everything in this track keeps Inbox Keys unchanged. The deciding question is account type. Ask it first.

> Is your Outlook a personal outlook.com / hotmail / live account, or a Microsoft 365 work or school account?

### Option zero, for one Gmail plus one Outlook: two pinned tabs

Before any consolidation, the single lowest-resistance answer for someone with exactly one Gmail and one Outlook is to run two tabs in their own Chrome profile and put a keyboard layer on each:

- Gmail tab at mail.google.com with Inbox Keys, unchanged.
- Outlook tab at outlook.office.com or outlook.live.com with OWA's built in Gmail keyboard mode on (Settings, General, Accessibility or Keyboard shortcuts, pick Gmail). That gives j/k/e/r letter shortcuts immediately with no extension.

This delivers most of the muscle memory benefit today with zero setup risk and no forwarding side effects. It applies to BOTH personal outlook.com and M365. It is the honest baseline; everything below is for people who specifically want their Outlook mail to live inside Gmail. Note that OWA's Gmail mode is a fixed letter-shortcut preset only. It has no chords (g i, g t) and no command palette, so it is not equivalent to Inbox Keys.

### A1. Personal outlook.com / hotmail / live

This works today and is genuinely zero code. The trick is to keep everything inside one Gmail tab so the existing Gmail-only Inbox Keys layer runs untouched. This is the path for someone who prefers to live in Gmail; anyone who prefers Outlook's own UI should use option zero above instead.

Receive (pull Outlook mail into Gmail):
1. In Outlook.com go to Settings, Mail, Forwarding.
2. Enable forwarding to the Gmail address and keep a copy in Outlook.
3. Mail now lands in Gmail in near real time (Outlook pushes on arrival).

Send as the Outlook address from Gmail:
1. On the Microsoft account, turn on two step verification, then generate a 16 character app password. The normal password will be rejected; basic password SMTP is disabled.
2. In Gmail, Settings, Accounts and Import, "Send mail as", add the outlook address.
3. SMTP server `smtp.office365.com` (or `smtp-mail.outlook.com`), port 587, TLS. Username is the full Outlook address, password is the Microsoft app password.

Result: send and receive for the Outlook address, all inside one Gmail web tab, and Inbox Keys works on all of it with no changes.

Caveats to set up front:

- "Works now," not "works forever." App password SMTP still functions for consumer outlook.com in 2026. The April 2026 and end of December 2026 Basic Auth deadlines you may read about are the Exchange Online M365 tenant retirement, NOT the consumer accounts. Microsoft could later extend the retirement to consumer accounts, so treat this path as current, not permanent.
- Forwarding limits. Outlook.com auto forwarding to an external address can be rate limited or flagged by Microsoft as suspicious, and consumer forwarding has historically been throttled. High volume may not all arrive promptly.
- Loss of structure and back sync. Outlook folders, categories, and server side rules do not carry over; forwarding flattens everything into the Gmail inbox. Read and archive state does not sync back to Outlook. Forwarded mail can also lose the original envelope sender, so some replies and threading can break.
- Send as deliverability risk. Mail sent from Google's servers under an `@outlook.com` From can fail Outlook's SPF/DMARC at the recipient and land in spam or get rejected. This is the most likely silent failure and people tend to blame the nearest tool, so flag it before they set it up.

### A2. Microsoft 365 work or school

Usually blocked, and not truly zero code because it needs IT. On a typical managed tenant all three doors are commonly shut:

- External auto forwarding is off by default (outbound spam policy, since 2020).
- POP and IMAP are disabled by default at the mailbox plan level and whenever Security Defaults are on.
- SMTP AUTH basic auth is being retired (off by default for existing tenants end of December 2026), so app password SMTP will not work long term even if enabled today.

Any one of these kills the Gmail consolidation path; together they usually do. And even in the lucky case where an admin HAS enabled external forwarding and IMAP, the send as half still needs SMTP AUTH, which is being disabled by default end of December 2026. So M365 consolidation into Gmail is a dead end medium term even on a permissive tenant, not just on a locked down one. This is exactly the wedge for the Track B conversation, not a consolidation target.

For M365 the realistic answer today is option zero: run OWA in its own tab with OWA's built in Gmail keyboard mode on and a dedicated Chrome profile. Gmail style shortcuts today, no extension, no IT request.

### A3. Two retired paths, do not recommend

Do not propose Gmailify or Gmail's "Check mail from other accounts" POP fetch. Google is turning both down: no new users after Q1 2026, fully off by January 2027. A new setup in 2026 cannot use them at all. The only forward looking zero code receive path into Gmail is forwarding.

---

## Track B: the product direction, an Outlook Web surface

This is the buildable feature. It is NOT inbox unification. It is a third surface that adds the Inbox Keys keyboard layer to Outlook on the web, mirroring exactly how the Google Calendar surface was added.

### B0. Why this shape is low risk

The repo already proved this pattern once. The Calendar layer is a self contained driver plus UI plus selector registry, loaded by its own `content_scripts` entry in `manifest.json` and gated by its own host permission. Confirmed live in the current manifest: `permissions` is `["storage"]` only, `host_permissions` is the two Google hosts, and the calendar entry loads `hashutil, keymap, storage, account-sync, toast, gcal.js, gcal-ui.js` and nothing Gmail specific. An Outlook entry mirrors that exactly. The only permission change is adding host permissions; `storage` stays the sole API permission, so the minimal permission story survives. It widens from two Google hosts to also include the OWA host the colleague actually uses, which the marketing line will need to acknowledge.

### B1. What is reusable versus net new

Drops in unchanged (surface agnostic, verified by the codebase):

- `src/content/toast.js`
- `src/content/storage.js` (just add OWA keys to `DEFAULTS`)
- `src/content/palette.css` (all `.inboxkeys-*` scoped, zero gmail/calendar references)
- `src/shared/keymap.js` (pure data, no provider dependency)

Reusable as a pattern to copy, not as is:

- `realClick` full pointer gesture and `waitFor` synchronous first poll. These are already duplicated between `gmail.js` and `gcal.js`, which confirms each surface re implements them. `owa.js` copies them too.
- The Cmd+K overlay. The Calendar surface did NOT reuse `palette.js` or `commands.js`; it built its own self contained overlay and command list inside `gcal-ui.js` (`openOverlay`, `openInput`, `showGuide`, `hardenField`, its own `onKeydown`, its own `KEY_ACTIONS`). `owa-ui.js` should do the same.

Net new, the hard 60 percent:

- `src/content/owa.js`. A full OWA DOM driver: its own `SEL` registry, an OWA `getContext` analog, a navigation and thread detection model, `verifySelectors`, and the action set.
- `src/content/owa-ui.js`. The OWA keyboard layer: its own capture phase `onKeydown` with `consume`, a curated single key set, and its own Cmd+K command list reusing `palette.css` classes.

Two couplings make the "copy Calendar" path mandatory rather than "reuse Gmail engine":

- `hotkeys.js` is hardwired to `InboxKeys.gmail` (it destructures `gmail` directly and gates on Gmail context string literals like `inboxList`, `threadView`). It is not surface parameterized, so OWA cannot reuse it. The Calendar surface already solved this by carrying its own keydown handler in `gcal-ui.js`. OWA follows suit.
- `commands.js` destructures `gmail/accounts/calendar/tabs` and every `run()` calls Gmail DOM modules. Also not reused on Calendar. `owa-ui.js` builds its own list.

`src/shared/hashutil.js` does NOT carry over. It is entirely Gmail's `#inbox/#search/<id>` hash scheme. OWA uses path and query based SPA routing, so `owa.js` needs its own navigation and thread detection from scratch.

### B2. The OWA driver, concretely

Scope v1 to ONE host plus ONE layout. OWA is forked across "new" and "classic" layouts AND three hosts (`outlook.office.com`, `outlook.office365.com`, `outlook.live.com`), each with obfuscated Fluent class names and virtualized lists. That is materially more selector surface and breakage than Calendar, which is one host and one layout. Build and test v1 against new OWA on `outlook.office.com` (the colleague's case drives the choice; pick `outlook.live.com` instead if the colleague is personal). Treat the other hosts and classic OWA as explicit follow ups. Do NOT declare all three hosts in v1 `host_permissions` while only testing one; declare the host you actually ship, then add hosts as you verify them. Shipping broad permissions you have not tested is a quiet Web Store review and breakage risk.

Engine philosophy ports cleanly. Page CSP does not constrain an isolated world content script's DOM driving in Chrome, so the `realClick` plus selector registry plus `getContext` plus `waitFor` discipline is the same. There is no evidence OWA blocks synthetic clicks specifically, but reuse `realClick` anyway, same as Gmail.

Selectors must be discovered and pinned live. Anchor on ARIA roles and stable hooks (`role=listbox/option/row`, `aria-label` on toolbar buttons, Fluent `data-automation-id`), never on class names. Expect a bigger, less stable registry than Gmail's, which makes `verifySelectors()` and the live smoke test more important here, not less.

Routing is drivable. OWA uses deep links: `/mail/deeplink/compose?to=&subject=&body=` for compose, item links with `?ItemID=...&viewmodel=ReadMessageItem` for opening a message, and folder paths. Compose with prefill via the deeplink URL is actually cleaner than Gmail. Folder navigation is more reliably done by `realClick` on the left rail nodes than by URL.

The `getContext` analog returns OWA named contexts in priority order, same idea as Gmail's `paletteOpen > modalOpen > compose > threadView > inboxList > searchFocused > unknown`, re derived against OWA's DOM. Keep the same capture phase keydown plus `consume` (preventDefault plus stopImmediatePropagation) so OWA never double handles a key.

First action set for v1: compose (with prefill), reply, reply all, archive, delete, mark read/unread, next/prev message, go to folder, search. Mirror these into the Cmd+K palette plus a small curated single key set, exactly like the Gmail and Calendar surfaces.

### B3. The account model, and how "unification" degrades

This is the weak spot and it must be scoped honestly.

Gmail's account story is clean: `/mail/u/N`, plus the OneGoogle bar enumeration (`account-bridge.js` MAIN world BFS over `window.gbar`, `account-sync.js` receiver) that labels each `u/N` with its email. None of this transfers to Microsoft. OWA is single active account per browser session, cookie/session based, with NO `/u/N` style numeric index. Opening a second account in another tab triggers conflict detection that redirects you back to the most recently active account. There is no `gbar` and no clean in browser multi account switch.

So:

- Scope account switching OUT of the OWA surface for v1. The realistic OWA multi account story is separate Chrome profiles or InPrivate windows per account, which a content script cannot orchestrate.
- What we CAN add, and should, is the Outlook tab as a destination in a cross surface jump. The Cmd+K "go to" list on each surface can include "Open Outlook" alongside the Google account switches. Be precise about what this is: a dumb single session tab jump (`window.open`/`location` to a known OWA URL), NOT account aware switching. It requires the OWA tab/session to already exist and be logged in; it cannot create or authenticate a session, and if the colleague has multiple OWA accounts it cannot target a specific one (no `/u/N`), so it lands on whatever account OWA last had active. Do not present it as parity with Gmail's labelled g0..g8.
- The `accountNames` shared storage map and the labelled switch command UI pattern carry over conceptually even though the enumeration mechanism does not.

How unification degrades, stated plainly: the deliverable is the SAME keyboard layer on two tabs (Gmail at mail.google.com, Outlook at outlook.office.com) plus a one keystroke jump between them. Each tab stays its own inbox. This is the same per account tab model Superhuman itself ships. It is not one merged stream and we should never market it as one.

### B4. Phased plan

Recommended first increment, the thin MVP. Before the full driver, ship the smallest thing that delivers what the colleague actually asked for: fast tab to tab plus a palette on Outlook. That is (a) the "Open Outlook" cross surface jump added to the Gmail and Calendar palettes, plus (b) a minimal `owa-ui.js` Cmd+K on one OWA host with just compose, reply, reply all, archive, and delete. Defer split inbox tabs and the full action set. This de risks the volatile selector work by proving the surface with a handful of selectors before investing in a large registry, and it reaches usable value fast.

Phase 1, spike and selector discovery. Open OWA live on the ONE chosen host plus layout (new OWA on `outlook.office.com`). Derive the `SEL` registry for the thin MVP action set. Confirm `realClick` drives the rail, toolbar, and list. Build `verifySelectors()` FIRST so breakage is observable from day one. No UI yet.

Phase 2, the driver. Write `owa.js`: `SEL`, copied `realClick`/`waitFor`, `getContext`, navigation/thread model, and the v1 action set (compose, reply, reply all, archive, delete, mark read/unread, next/prev, go to folder, search). Mirror the Gmail test discipline: jsdom fixtures using the real verified OWA selectors, source greps that pin selector strings, and the failing scenario added as a test when a bug is fixed.

Phase 3, the UI layer. Write `owa-ui.js` mirroring `gcal-ui.js`: own Cmd+K overlay reusing `palette.css`, own capture phase `onKeydown` with `consume`, curated single keys, own command list. Add the OWA `content_scripts` entry and the single shipped host permission to `manifest.json`. Add OWA keys to `storage.js` `DEFAULTS`. Port the Playwright readonly smoke to OWA selectors and make it a RELEASE GATE, not later polish, because OWA breakage will be more frequent than Gmail's.

Phase 4, expand and polish. Add an "Open Gmail" entry to OWA so tab to tab is symmetric. Add the second and third hosts and classic OWA only after each is verified live, adding each host permission as it ships. Consider split inbox saved search tabs on OWA. Update README and the permission line.

Explicitly out of scope for v1: in browser OWA multi account switching, additional hosts/layouts beyond the one shipped, and any cross provider merge or unified search.

---

## Why not the Microsoft Graph API path

It is technically buildable and it is the Superhuman model, and it is the wrong fit for this product.

You could do OAuth2 auth code with PKCE through `chrome.identity.launchWebAuthFlow` against Microsoft Graph (`/me/messages`, `/sendMail`). But every load bearing assumption of Inbox Keys breaks:

- It stops being zero API and no mail data. The extension would now read message bodies, subjects, senders, and send mail, and hold OAuth tokens. That triggers Chrome Web Store sensitive data disclosures, a privacy policy, and Microsoft app verification.
- It stops being zero build. MSAL.js does not run in an MV3 service worker (no `window`); the working samples need JSDOM, msrCrypto, and a localStorage shim, or a hand rolled PKCE flow. Either way it breaks the zero dependency, no build rule.
- Token custody has no safe client side answer. A distributed extension cannot embed a confidential secret. The SPA registration type caps refresh tokens at a non configurable 24 hours (forced daily reauth); the desktop type is not permitted cross origin token redemption and would mean storing a long lived mailbox refresh token in `chrome.storage`, a real exfiltration risk. The clean version needs a backend for token rotation, which the product does not have.
- On work tenants `Mail.ReadWrite` and `Mail.Send` are admin consent gated. If user consent is disabled (common on managed M365), the colleague hits AADSTS90094 and is simply blocked until IT approves.
- There is no mail rendering UI to render Graph results into; the extension only augments existing DOM. That is net new product surface.

This is weeks of security sensitive work that converts Inbox Keys into a backend leaning, broad permission client. If unified Outlook is ever a hard requirement, it is a new product decision, not a feature toggle on this one.

---

## Tradeoffs and limitations versus Superhuman

- No merged inbox. Two providers stay two tabs. (Superhuman does not truly merge either, but it at least indexes both server side. A true merged inbox needs a separate multi provider client.)
- No unified search, no cross provider snippets, no cross provider scheduling or snooze. All need an index we do not have.
- Weaker account switching on the Outlook side. No `/u/N`, single active session, so v1 has no in browser OWA multi account switch and "Open Outlook" is a dumb single session tab jump, not labelled account switching.
- Heavier maintenance. OWA's React/Fluent DOM is more volatile than Gmail's `gh=`/`role=` hooks, and it is forked across hosts and layouts; expect more selector breakage and lean harder on `verifySelectors` and the smoke gate. v1 deliberately covers one host plus one layout to keep this bounded.
- Permission story widens to the one shipped OWA host. Still "storage plus runs on these sites", but the minimal footprint line needs updating and Web Store review scrutiny rises with each host.
- Enterprise gating. On M365, Conditional Access and managed browser extension allow/blocklists can block OWA or the extension outright. IT, not the code, may decide.

What we match: the same Cmd+K palette, chords, and realClick driven controls, now on Outlook, plus a fast tab jump between them. That is the per account tab model Superhuman itself recommends.

---

## Recommendation

For THIS colleague right now: ask the account type first.

If they have one Gmail plus one Outlook and just want speed today, option zero is the single lowest resistance answer regardless of account type: two pinned tabs in a dedicated Chrome profile, Inbox Keys on the Gmail tab, OWA's built in Gmail keyboard mode on the Outlook tab. No forwarding, no IT, no extension change.

If they specifically want Outlook mail living inside Gmail and it is a personal outlook.com account, do Track A1: forward Outlook into Gmail to receive, and Gmail "Send mail as" over Outlook SMTP with a Microsoft app password to send. Warn them this is "works now" not "works forever," that consumer forwarding can be throttled, and about the send as SPF/DMARC spam risk.

If it is Microsoft 365 work/school, set expectations that zero code consolidation into Gmail is probably blocked by IT and is a medium term dead end even on a permissive tenant. The immediate win is option zero, OWA in its own tab with Gmail keyboard mode.

If a true merged inbox is the hard requirement, point them at an existing multi provider desktop client; no Gmail DOM layer can do it.

For the build: if a consistent Inbox Keys experience on Outlook matters beyond the stopgap, build the Track B Outlook Web surface, copying the Google Calendar precedent. Start with the thin MVP ("Open Outlook" jump plus a minimal OWA palette), scope v1 to ONE host plus layout, make `verifySelectors` and the Playwright smoke a release gate, scope out OWA multi account switching, and never promise a merged inbox. Do NOT take the Graph API path; it is a different product and it breaks the no backend, minimal permission, no mail data identity that is the whole pitch.
