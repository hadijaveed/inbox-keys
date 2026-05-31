// Pure helpers for reasoning about Gmail's URL hash. No DOM, no chrome APIs, no
// other CMDK modules — so it loads first as a content script AND can be required
// straight into Node for unit tests (dual export at the bottom).
//
// Gmail routes everything through the hash:
//   #inbox                         list
//   #search/<query>                search-results list
//   #label/<name>                  label list
//   #inbox/<thread-id>             a conversation opened from the inbox
//   #search/<query>/<thread-id>    a conversation opened from search  <-- the bug
//   #label/<name>/<thread-id>      a conversation opened from a label
//
// The conversation id is ALWAYS the last "/"-separated segment, no matter how
// many list/query/label segments precede it. The old detector assumed the id was
// the SECOND segment (`#view/<id>`), so for `#search/<query>/<id>` it matched the
// query instead and `inThread()` came back false — killing every thread shortcut
// until the search box was cleared. We instead look at the LAST segment only.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // Node: `const { hashIsThread } = require(...)`
  } else {
    root.CMDK = root.CMDK || {};
    root.CMDK.hashutil = api; // Gmail: window.CMDK.hashutil
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  // Gmail conversation ids are long opaque tokens (observed: 32 chars of
  // [A-Za-z0-9_-], e.g. FMfcgzQgMCZXKzQzpdVlZBPgJlsjMpsw). A search query or
  // label slug in the last position is virtually never a bare 20+ char token of
  // that alphabet (queries carry %/:/@/spaces, labels are short or %2F-encoded).
  // The 20-char floor leaves a wide margin under the real 32-char ids while
  // excluding queries. getContext() also requires a rendered message before it
  // trusts this, so even a freak long single-word query cannot fake a thread.
  const THREAD_ID = /^[A-Za-z0-9_-]{20,}$/;

  function lastSegment(hash) {
    const h = String(hash || "");
    const slash = h.lastIndexOf("/");
    return slash < 1 ? null : h.slice(slash + 1);
  }

  // True when the hash points at a single open conversation.
  function hashIsThread(hash) {
    const seg = lastSegment(hash);
    return seg != null && THREAD_ID.test(seg);
  }

  // The list a thread sits in: drop the trailing "/<thread-id>" segment.
  //   #inbox/<id> -> #inbox,  #search/<q>/<id> -> #search/<q>
  // Not a thread (already a list) -> returned unchanged; empty -> #inbox.
  function parentHash(hash) {
    const h = String(hash || "");
    if (!hashIsThread(h)) return h.startsWith("#") ? h : "#inbox";
    return h.slice(0, h.lastIndexOf("/")) || "#inbox";
  }

  return { hashIsThread, parentHash };
});
