## docs/architecture.md lines 1118-1312

(End of "Technology Stack" table, then the start of "Contributor rules": TOC + six rule sections — Server/Client Module Boundary, Instance Limits, Date Serialization, Client-Side API Calls, Outbound Server-Side HTTP Requests, Link prefetching, Navigation Customization, and most of Page Header & Sub-Navigation.)

### Duplicates
- docs/architecture.md:1141 ≈ docs/fitness-file-storage.md:466, docs/maintenance.md:984, docs/mastodon-api-compatibility.md:1098, docs/setup.md:365 — identical "Contributor rules" boilerplate paragraph: "Read the applicable rules and review checks below before changing this subsystem. The mandatory workflow remains in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md)." (checked: `git grep -nF 'The mandatory workflow remains in'`)
- docs/architecture.md:1133 ≈ README.md:53 — "Yarn 4 … exact version pinned via `packageManager` in `package.json`" stated in both the Technology Stack table and README's requirements list (checked: `git grep -nF 'packageManager' -- docs/architecture.md README.md`). Minor; README intro vs stack table is a tolerable overlap.
- docs/architecture.md:1270 ≈ docs/architecture.md:1272 — "Account & security is reachable only from this menu and the Settings index footer card" appears twice inside the same Account-menu bullet (item 5 and the rail/drawer continuation); the Settings → Sidebar note at 1264 restates it a third time.
- docs/architecture.md:1186 mentions `app/api/v1/accounts/outbox` in the poll-outage story and 1198/1217 call it "deprecated / legacy … only for backward compatibility" — the route's deprecated status is restated three times in the slice.

### Stale
- none — all files/symbols checked exist: `lib/services/statuses/pollDurations.ts`, `lib/clientModuleBoundary.test.ts`, `lib/clientImportGraph.test.ts`, `lib/utils/safeRemoteFetch.ts`, `lib/utils/boundedRequestBody.ts`, `lib/services/notifications/pushEndpoint.ts`, `scripts/maintenance/backfillGalleryLookups.ts`, `lib/services/profile-links/verifyProfileLink.ts`, `lib/services/gallery/lookups/`, `lib/services/navigation/navPreferences.ts`, `lib/components/layout/nav-items.ts`, `app/(timeline)/PendingProfileNavigation.tsx`, `app/(timeline)/NewPostsPill.tsx`, `lib/components/navigation-history/backDestination.ts`, `lib/client/drafts/submitRequest.ts`, `lib/components/instance-limits.tsx`, `lib/utils/version.ts`; symbols `getFederationSigningActor`, `MAX_PUSH_SUBSCRIPTIONS_PER_ACTOR`, `DRAFT_LOCKED_NOTICE`, `classifyFailedPost`, `createUnseenAboveStore`; `app/api/v1/accounts/outbox` still tracked (4 files); `--container-content: 940px` still in `app/globals.css:93`.

### History / changelog text
- docs/architecture.md:1186 — "It cost a complete outage of poll creation" — past-incident narrative (5+ clauses retelling the bug) inside a durable rule.
- docs/architecture.md:1226 — "#1122 removed viewer signing" — PR number and change history.
- docs/architecture.md:1247 — "This is the bug that flooded production" — past-incident story.
- docs/architecture.md:1249 — "a profile click used to leave the old page frozen" — "used to" history.
- docs/architecture.md:1259 — "The previous `account` … nav item was removed from the main navigation" — change history.
- docs/architecture.md:1265 — "(no longer a plain link to the profile)" — past-state contrast.
- docs/architecture.md:1273 — "keying on the visible state made Reset a no-op" — past-bug narrative.
- docs/architecture.md:1289 — "which sits beside the title as it did before the redesign" — redesign history.
- docs/architecture.md:1292 — "do **not** reintroduce the old two-tier … split … is gone and must not come back" — history framing, though it functions as an anti-regression guard; the rule could be stated once without the archaeology.

### Long sections
- docs/architecture.md:1280-1435 `### Page Header & Sub-Navigation` (156 lines) — mixes durable PageHeader API rules with a route-by-route skeleton inventory; split into a PageHeader/mobile-chrome section and a separate per-route skeleton reference.
- docs/architecture.md:1221-1243 `### Outbound Server-Side HTTP Requests` (23 lines, but several bullets are 200-400 words; the `gallery_lookup_cache` bullet at 1234 is one ~350-word sentence) — move the gallery-lookup cache/privacy detail to a gallery or data doc; keep the fetch rule here.
- docs/architecture.md:1139-1180 `## Contributor rules` (42 lines) — pure anchor TOC of 40 links; fine as a TOC, but it duplicates the heading list itself and must be maintained by hand.

### Task/PR-specific
- none — no checklists or single-task instructions; the per-route skeleton inventory (1296-1311) is per-route snapshot detail rather than task-specific, but it is the most rot-prone content in the slice.

### Readability
- Bullets routinely run 200-400 words as one sentence with 8+ nested clauses (1217, 1234, 1295, 1303, 1306); walls of text that bury the actual rule.
- 1296-1311 embed exact pixel measurements (79px, 75px, 4px jump, `h-7`/`h-4`, `md:min-h-[46px]`, safe-area calc strings) — implementation detail that belongs in code/tests, not durable docs.
- Repeated "never/always/must not come back" guards inside the same bullets that already state the rule ("Never hardcode a nav list", "do not re-enable prefetching", "do not reintroduce").

### Slice summary
Start of the "Contributor rules" body: a hand-maintained anchor TOC plus six durable rule sections. All referenced files/symbols verified as existing (no stale content found). Roughly a third could go or move: the past-bug/PR narratives, the gallery-cache deep-dive, and the per-route pixel-level skeleton inventory; plus the boilerplate intro paragraph duplicated across five docs files.
