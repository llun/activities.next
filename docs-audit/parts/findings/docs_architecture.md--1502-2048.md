## docs/architecture.md lines 1502-2048

### Duplicates
- docs/architecture.md:1509 ≈ docs/setup.md:380 — the `agents/no-component-fetch` frozen `allowFiles` list and "never add to it / migrate to `lib/client.ts`" rule is stated in both.
- docs/architecture.md:1577 ≈ docs/architecture.md:3665 + docs/maintenance.md:586-610 — the `renderEmailPreviews.ts` verification workflow is described here, again later in the same file, and in full in maintenance.md (which this bullet already cross-references).
- docs/architecture.md:1541 ≈ docs/architecture.md:3652 — "Every `href`/`src` is absolute and built from `brandBaseURL(brand)`" appears nearly verbatim twice in this file.
- docs/architecture.md:1722 ≈ docs/architecture.md:3962 — the "`SANITIZED_TRUSTED_STATUS_OPTION` must SPREAD `allowedClasses` rather than replace it" warning appears twice.

### Stale
- docs/architecture.md:1509 — "A dozen legacy components still call `fetch()` directly ... frozen in the `allowFiles` list" — checked: `grep -n 'allowFiles' .oxlintrc.json` → line 240 is `"allowFiles": []` (empty; the other occurrence is a comment), and `git grep -nE '[^a-zA-Z.]fetch\(' -- 'app/(timeline)/account' 'lib/components/settings'` → no hits. The migration the bullet mandates has happened; the whole "dozen legacy components" sentence is outdated (the "never add to it" rule itself survives in setup.md:380).

### History / changelog text
- docs/architecture.md:1524-1526 — "three of the four account emails used to, which is exactly why they could not be restyled together"
- docs/architecture.md:1566-1567 — "Both used to be maintained by hand and had already drifted apart."
- docs/architecture.md:1571-1573 — "This has already happened twice (`deleteActorJob.test.ts` and the password-reset route test)"
- docs/architecture.md:1658-1668 — "one transient 502 on a weekly refresh blanked the card ... There was no repair path either" — narrative of a fixed past bug.
- docs/architecture.md:1734-1760 — "Four separate things went wrong here" — enumerated past-bug walkthrough (numbered items 1-4 are each a historical incident).
- docs/architecture.md:1762-1766 — "deleted real emoji from ~2% of a live Pleroma and a live Akkoma instance's packs" — past-incident field report.
- docs/architecture.md:1816-1820 — "Three separate phishing cards came out of getting this wrong"
- docs/architecture.md:1836-1843 — "It was written that way and the tokens are the wrong shape for this job three times over ... which crashed the walker"
- docs/architecture.md:1881-1882 — "there was no `frame-src` at all before this"
- docs/architecture.md:1907-1909 — "do not repeat the earlier claim that it measured zero, which was an artefact of the measurement method"
- docs/architecture.md:1924-1925 — "that mistake cost this feature two review rounds"
- docs/architecture.md:1929-1935 — "it was the original guard and it was insufficient — the remembered id was only ever compared against, never cleared" — past-bug narrative for the autoplay remount key.
- docs/architecture.md:1969-1973 — "but it stopped mattering when extraction moved to rendering the text ... Verified both ways round."
- docs/architecture.md:1994-1996 — "that is exactly the bug `sendUndoAnnounceJob` shipped with — ... no unboost ever federated"

### Long sections
- docs/architecture.md:1515-1643 `Transactional & Notification Emails` (129 lines) — six bullets, several of 200-400 words each; could be split into per-topic subsections (branding, escaping, previews, avatars) but content is largely durable reference.
- docs/architecture.md:1644-1981 `Link Preview Cards` (338 lines) — 20+ bullets, many 300+ words with deep parser forensics; badly needs splitting (extraction/sanitization vs. rendering/CSP vs. ops/kill switch); the durable rules are buried under incident narratives.

### Task/PR-specific
- docs/architecture.md:1896-1930 — Playwright focus-indicator measurement recipe (count pixels, screenshot the wrapper, `:focus-visible` modality traps) is a one-feature verification how-to, not durable architecture.
- docs/architecture.md:1974-1979 — "the thing to check before making it is ... schedule the sync AFTER the poll has published" — instructions for a future one-line change that has not been made.

### Readability
- Single bullets run to 400+ words (e.g. 1513, 1540, 1541, 1697-1728, 1745-1766) with nested parenthetical caveats three levels deep — walls of text.
- Heavy repeated NEVER/ALWAYS/MUST bolding throughout; near every bullet opens with an imperative plus a justification clause.
- Chromium-only checking disclaimers and pixel measurements ("measured at 1416 pixels against the shipped overlay's 4412", 1905-1906) are snapshot details that will rot.

### Slice summary
Covers four rule sections: Settings Forms, Transactional & Notification Emails, Link Preview Cards (the bulk), and Status Delete & Unboost Federation. Almost all content is durable reference, but the two big sections are bloated by past-bug/PR narratives (14 history passages) and could shrink by roughly a third if those moved out; one confirmed stale claim (the "dozen legacy components" fetch list, now empty), and the renderEmailPreviews and no-component-fetch rules are stated in 2-3 places each.
