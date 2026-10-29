## docs/mastodon-api-compatibility.md lines 1706-1979

### Duplicates
- none confirmed within the slice. Several rules here are stated as extensions of rules documented elsewhere (e.g. `confirmActorHandle` in architecture.md, `isSameActivityPubOrigin` in the ActivityPub & JSON-LD section), but each statement in this slice adds slice-specific detail rather than restating; no verbatim/semantic duplicate was confirmed.

### Stale
- none. All referenced paths checked and present: `scripts/backup/actorArchive.ts`, `lib/services/statusAccess.ts`, `lib/services/getViewerFollow.ts`, `lib/utils/username.ts`, `lib/utils/normalizeUsername.ts`, `lib/database/kysely/usernameMatch.ts`, `lib/database/kysely/visibility/{publiclyReadable,actorVisible}.ts`, `lib/database/publiclyReadableStatus{QueryShape,CallSites}.test.ts` (as `lib/database/publiclyReadable*.test.ts`), `lib/activities/quoteNoteFields.ts`, `lib/services/mastodon/resolveClientId.ts`, `app/api/v1/accounts/lookup/route.ts`, `app/(timeline)/[actor]/getProfileData.ts` and its `.identity.test.ts`, `lib/database/domains/status/statusReadableSql.test.ts`, `lib/services/accounts/localUsername.test.ts`. No stale package.json scripts, env vars or commands referenced.

### History / changelog text
- 1737-1739 — "That one was shipped correlated and caught in review, which is why the shape test now pins it" — PR-review narrative; the durable part (the shape test pins `getRebloggedBy`) survives without it.
- ~1748-1750 — "on 2026-08-25 a burst of 530 outbox root fetches in 11 minutes ... taking the query's average wall time to 899ms" — dated incident write-up inside the caching bullet; the rule (cache the promise, TTL + concurrent-miss collapsing) stands without the incident date and latency figures.
- 1835-1837 — "which round 1 of #1592 removed as false and which survived here only because that round fixed two of the three copies" — pure change-log narrative about how the wording evolved.

### Long sections
- 1706-1721 "Who May See an Actor's Statuses" continuation bullets (slice opens mid-section; the section header precedes 1706) — bullets run 8-15 lines each with nested caveats; could be split but content is load-bearing.
- 1740-1776 "Review: API routes" (37 lines) — reference-list shape, fine.
- 1777-1890 "Review: Actor usernames" (~114 lines) — a single bullet on username validation runs ~40 lines and the rename/lookup bullets ~20 each; could be split into "validation" vs "lookup/folding" subsections.
- 1891-1906 "Review: Mastodon and Fediverse Interoperability Quirks" — bullets are long but individually scoped.
- 1907-1978 "Review: Fetched ActivityPub document ids" (~72 lines) — under the 80-line threshold only because the slice ends; individual bullets are dense walls (one runs ~14 lines unpunctuated).

### Task/PR-specific
- 1835-1837 — "round 1 of #1592" — release/PR-round narrative, not a durable rule.
- 1743-1751 — the seed-shape benchmark figures (176,000 statuses, 14,900 actors, "33,308-33,311 buffers at limits of 20, 30 and 40") are measurements of a past tuning exercise, not rules; the durable rule is "keep the correlated form, do not add a check-depth-1 fast path".
- 1763-1766 — the caching bullet's CloudFront/`Signature`/`Date` deployment history ("llun.dev's CloudFront policy keyed on Signature and Date when this was written") is incident narration; the rule it supports (origin must survive a burst alone) is durable.

### Readability
- Whole slice is bullet lists with 8-15-line bullets carrying three or more caveats per bullet (bold rule, then exceptions, then measurements, then "left for its own change" footnotes) — hard to scan; the bolded first sentence carries the rule and the rest could move to a rationale note.
- Measurements (buffers/ms figures) are interleaved with normative rules in the same bullets, blurring which sentence is the rule; separating "rule" from "why/measured" would fix most of the length.

### Slice summary
Review-style bullet reference: profile/status visibility fail-open rules, viewer-follow read path, username validation/folding, and fetched-document id guards. No duplication or staleness found; the main issues are PR-narrative sentences embedded in three or four bullets and very long multi-caveat bullets in the Actor-usernames and Fetched-ids sections.
