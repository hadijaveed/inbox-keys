// Unit tests for the hash primitives that gate every thread/list shortcut.
// The regression these lock down: a conversation opened from the search box
// (#search/<query>/<thread-id>) was reported as "not a thread", so arrow keys,
// j/k, e, Enter, Escape all went dead until the search box was cleared.
const assert = require("node:assert/strict");
const { hashIsThread, parentHash } = require("../src/shared/hashutil.js");

// A real id observed live in Gmail (32 chars). Used everywhere so the tests
// exercise the actual token shape, not a toy stand-in.
const ID = "FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw";

// ---- hashIsThread: an open conversation, from any kind of list ----
const threadHashes = [
  ["#inbox/" + ID, "inbox thread"],
  ["#search/adam/" + ID, "thread opened from a text search (THE BUG)"],
  ["#search/is%3Aunread/" + ID, "thread opened from a search-operator query"],
  ["#search/from%3Aboss%40acme.com/" + ID, "thread opened from an encoded query"],
  ["#label/Clients/" + ID, "thread opened from a label"],
  ["#label/Work%2FClients/" + ID, "thread opened from a nested label"],
  ["#imp/" + ID, "thread opened from Important"],
  ["#all/" + ID, "thread opened from All Mail"],
  ["#starred/" + ID, "thread opened from Starred"],
];
for (const [hash, why] of threadHashes) {
  assert.equal(hashIsThread(hash), true, "should be a thread: " + why + " (" + hash + ")");
}

// ---- hashIsThread: lists / non-threads must stay false ----
const listHashes = [
  ["#inbox", "inbox list"],
  ["#search/adam", "search results list — query is the last segment, not an id"],
  ["#search/is%3Aunread", "search-operator results list"],
  ["#label/Clients", "label list"],
  ["#label/Work%2FClients", "nested label list"],
  ["#settings/general", "settings pane is not a conversation"],
  ["#imp", "Important list"],
  ["", "empty hash"],
  ["#", "bare hash"],
  ["#search/adam/short", "trailing segment too short to be an id"],
  ["#search/from%3Ame", "search-operator query, no id segment"],
];
for (const [hash, why] of listHashes) {
  assert.equal(hashIsThread(hash), false, "should NOT be a thread: " + why + " (" + hash + ")");
}

// hashIsThread is a SHAPE check by design: the id floor is kept low (20) so a
// real 28-32 char id is never missed — missing one is the bug we're fixing.
// The cost is that a freak 20+ char single-word query (no %/:/operators) is
// shape-indistinguishable from an id and reads as true here. That's deliberate
// and harmless: getContext() ANDs this with "a message is actually rendered",
// so such a search-results LIST still classifies as inboxList. getcontext.test.js
// proves that end-to-end.
assert.equal(hashIsThread("#search/supercalifragilistic20x"), true, "long bare-word query is thread-SHAPED; DOM guard rejects it");

// ---- parentHash: strip the thread id to get its list ----
assert.equal(parentHash("#inbox/" + ID), "#inbox");
assert.equal(parentHash("#search/adam/" + ID), "#search/adam", "search thread -> its results list");
assert.equal(parentHash("#search/is%3Aunread/" + ID), "#search/is%3Aunread");
assert.equal(parentHash("#label/Clients/" + ID), "#label/Clients");
assert.equal(parentHash("#label/Work%2FClients/" + ID), "#label/Work%2FClients");
// Already a list (or empty): unchanged / safe default — never strips a real segment.
assert.equal(parentHash("#inbox"), "#inbox");
assert.equal(parentHash("#search/adam"), "#search/adam");
assert.equal(parentHash(""), "#inbox");
assert.equal(parentHash("#"), "#");

// ---- the round-trip the user actually hits: open from search, Escape back ----
const openedFromSearch = "#search/adam/" + ID;
assert.equal(hashIsThread(openedFromSearch), true, "Escape only fires back() when this is a thread");
assert.equal(parentHash(openedFromSearch), "#search/adam", "Escape lands back on the search results, not #inbox");

console.log("hashutil tests passed");
