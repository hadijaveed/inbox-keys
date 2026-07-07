// Unit tests for the MAIN-world account bridge's extractor. The extractor finds
// the OneGoogle account list inside an arbitrary object graph WITHOUT depending
// on Google's minified key names, reading each account's email (by regex) and
// /u/N index (parsed from a URL property), with the URL-less entry resolved to
// the current account index. We feed it synthetic graphs shaped like the real
// gbar (verified live: accounts live behind nested objects, with the active
// account carrying no switch URL).
const assert = require("node:assert/strict");
const { extractAccounts } = require("../src/content/account-bridge.js");

// 1. A realistic graph: the account array is nested behind plain objects, the
//    active account (current index) has no switch URL, others carry /mail/u/N.
{
  const gbar = {
    junk: 1,
    a: {
      noise: [1, 2, 3],
      deep: {
        accounts: [
          { Ca: "Me", Ba: "me@gmail.com", oa: true }, // active: no URL
          { Ca: "Work", Ba: "work@revelai.com", Wh: "https://mail.google.com/mail/u/3/" },
          { Ca: "Side", Ba: "side@x.com", Wh: "https://mail.google.com/mail/u/5/" },
        ],
      },
    },
    fn: function () {}, // functions are not traversed
  };
  const accts = extractAccounts(gbar, 0);
  assert.deepEqual(
    accts,
    [
      { index: 0, email: "me@gmail.com", name: "Me" },
      { index: 3, email: "work@revelai.com", name: "Work" },
      { index: 5, email: "side@x.com", name: "Side" },
    ],
    "extracts every account with the right /u/N index, resolving the URL-less entry to the current index"
  );
}

// 2. Calendar-style switch URLs (/calendar/u/N) are parsed the same way.
{
  const gbar = {
    x: {
      list: [
        { Ba: "a@x.com", Wh: "https://calendar.google.com/calendar/u/1/r" },
        { Ba: "b@y.com", Wh: "https://calendar.google.com/calendar/u/2/r" },
      ],
    },
  };
  const accts = extractAccounts(gbar, 1);
  assert.deepEqual(accts.map((a) => a.index), [1, 2], "parses /u/N out of calendar URLs too");
}

// 3. Decoys: arrays of plain email strings (not account objects) are ignored;
//    only an array of >=2 distinct objects each owning an email qualifies.
{
  const gbar = {
    emailsOnly: ["a@b.com", "c@d.com"], // strings, not objects → ignored
    real: {
      accts: [
        { Ba: "one@x.com", Wh: "https://mail.google.com/mail/u/0/" },
        { Ba: "two@x.com", Wh: "https://mail.google.com/mail/u/1/" },
      ],
    },
  };
  const accts = extractAccounts(gbar, 0);
  assert.deepEqual(accts.map((a) => a.email), ["one@x.com", "two@x.com"], "string-only arrays don't fool the finder");
}

// 4. No account data anywhere (e.g. Calendar's gbar) → empty list, no throw.
{
  assert.deepEqual(extractAccounts({ a: { b: { c: 1 } }, only: ["solo@x.com"] }, 0), [], "returns [] when there is no account array");
  assert.deepEqual(extractAccounts(null, 0), [], "null root is safe");
  assert.deepEqual(extractAccounts(undefined, 2), [], "undefined root is safe");
}

// 5. Duplicate indices collapse to one row (defensive against repeated entries).
{
  const gbar = {
    list: [
      { Ba: "a@x.com", Wh: "https://mail.google.com/mail/u/2/" },
      { Ba: "a2@x.com", Wh: "https://mail.google.com/mail/u/2/" },
      { Ba: "b@x.com", Wh: "https://mail.google.com/mail/u/3/" },
    ],
  };
  const accts = extractAccounts(gbar, 0);
  assert.deepEqual(accts.map((a) => a.index), [2, 3], "duplicate /u/N indices collapse to a single row");
}

console.log("account-bridge extractor tests passed");
