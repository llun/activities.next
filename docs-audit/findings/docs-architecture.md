# Findings: docs/architecture.md

Generated slice by slice by GLM-5.3-flash from origin/main aa368a596 (brief: ../findings-brief.md).

## docs/architecture.md lines 1-285

### Duplicates
- docs/architecture.md:117 ≈ AGENTS.md:138 ≈ CONTRIBUTING.md:520 — the migrations boilerplate ("`yarn migrate` runs with Kysely's migrator, registered in `migrations/index.ts` (their names in `migrations/names.ts`). The first, `20261014000000_baseline`, loads the frozen schema in `migrations/baseline/`") is stated three times almost verbatim; docs/maintenance.md:7 covers the same handover in its authoritative form.
- docs/architecture.md:211 ≈ docs/mastodon-api-compatibility.md:1170 — the whole RFC 9421 / draft-cavage inbound-verification spec (covered components, 8 KB/1 KB caps, 64-parameter limits, 12-hour freshness window, RFC 9530 Content-Digest, "no RFC 9421 signing and no double-knocking") is restated in both. The Mastodon doc even cross-links to architecture.md for the required components, then repeats them anyway. One location should carry the spec.
- docs/architecture.md:261 ≈ docs/architecture.md:325 ≈ docs/environment-variables.md:417 — polynomial-backoff retry + dead-letter behavior described twice inside this slice's file and again in the env-var table.
- docs/architecture.md:266 ≈ docs/fitness-file-storage.md:17-18 ≈ docs/maintenance.md:633 — the Wahoo routes (`/api/v1/settings/fitness/wahoo/authorize|callback`, `/api/v1/webhooks/wahoo/` with its trailing slash), the `wahoo_imports` row, and the retry/history behavior each appear in three files. architecture.md:266 is a ~200-word paragraph that belongs in the fitness guide.
- docs/architecture.md:274 ≈ docs/mastodon-api-compatibility.md:438,460 — the bulk-CSV-import behavior (20,000 rows, `bulk_imports`/`bulk_import_rows`, "Abandoned: no progress" lease handling) is described in both files.

### Stale
- none — verified: all 23 referenced files/symbols resolve via `git ls-files` (resolveClientId.ts, resolveStatusFromPath.ts, urlToId.ts, domainCheck.ts, servedDomainSnapshot.ts, signUpDomain.ts, domainIdentity*.ts, domainScope.ts, visitedFeatures.ts, domainAudience.ts, httpMessageSignature.ts, contentDigest.ts, deliverActivityJob.ts, replyCommunity.ts, createNote.ts, gallery/albums.ts, getSQLDatabase.ts, connection.ts, test/next.config.test.ts, proxy.ts, app/manifest.ts); all `ACTIVITIES_*` env vars named in the slice exist in `lib/` (ACTIVITIES_HOST, ACTIVITIES_TRUSTED_HOSTS, ACTIVITIES_SERVICE_NAME, ACTIVITIES_ENABLE_INBOX_FORWARDING, ACTIVITIES_QUEUE_TYPE); all six `@activities/*` workspace packages exist under `packages/`; the Wahoo routes exist under `app/`; the `#agents-better-auth-session-refresh` anchor target exists (explicit `<a id>` at docs/architecture.md:2831).

### History / changelog text
- docs/architecture.md:92-93 — "(rewritten from `/inbox`)" and "(rewritten from `/.well-known/nodeinfo`)" — notes about where these routes used to live; meaningless to a new reader of the current tree.
- docs/architecture.md:117 — "or records it on one the Knex migrations of v1.192.34 built" — Knex-handover release narrative inside the durable migrations paragraph.
- docs/architecture.md:167-170 — "a row written before the publicId backfill … backfill script that ships with v1.192.34" — rollout history of a one-time migration, twice in five lines.

### Long sections
- none over 80 lines in this slice. Longest is Public Identifiers at 43 lines (129-171); it is reference explanation and must stay, though its three history sentences (above) can go.

### Task/PR-specific
- docs/architecture.md:194 — "**Rules, announcements, reports and features are per domain too** (step 5)" — "(step 5)" is a dangling reference to a numbered implementation/migration plan that does not exist in the docs.
- docs/architecture.md:92-93 — "(rewritten from …)" parentheticals are release-specific notes (also listed under history).

### Readability
- docs/architecture.md:185-195 (Served Domains) — six bullets, each 150-330 words of run-on prose with parentheses nested four deep (e.g. the "Rules, announcements, reports and features are per domain too" bullet packs the schema, audience rules, admin scope resolution, and four admin-UI boxes into one bullet). Deserves sub-bullets or splitting per topic.
- docs/architecture.md:211 (Inbound Forwarding & Verification, first bullet) — one ~280-word bullet mixing the RFC 9421 component rules, size caps, clock-skew policy, draft-cavage fallback and outbound-policy statements; a spec table or sub-bullets would be scannable.
- docs/architecture.md:261-266 (Background Jobs / Wahoo) — the Wahoo paragraph interleaves webhook routing, next.config.ts redirect rules, OAuth token binding, queue locking and history-scan locking in one paragraph; the locking details would read better as a list.

### Slice summary
Lines 1-285 are the architecture overview: client/application/infrastructure boundaries, request-flow diagrams, directory tables, and key design decisions (database abstraction, Mastodon compat, public identifiers, auth, served domains, federation, jobs). The front half (through Directory Structure, 1-118) is clean durable reference. The back half accretes feature notes: served-domain policy details, the full 9421 signature spec, Wahoo sync internals and bulk-import lease mechanics — all of which have feature-specific homes (mastodon-api-compatibility.md, fitness-file-storage.md, maintenance.md) that already partially duplicate them. Roughly 20-25% of the slice (the Wahoo paragraph, the 9421 spec detail, the migration-handover/backfill history, the "(step 5)" remnant) could move or go.

## docs/architecture.md lines 286-570

### Duplicates
- docs/architecture.md:291 ≈ docs/features.md:74 — album caps ("200 albums per actor, 2,000 items per album" vs "An album never holds more than 2,000 photos, an actor no more than 200 albums")
- docs/architecture.md:294-296 ≈ docs/features.md:74 — gallery album suggestions: not stored, computed on GET /api/v1/gallery/albums/suggestions, UTC-day semantics, visible-to-visitor titles; features.md:74 restates nearly every rule
- docs/architecture.md:309 ≈ docs/architecture.md:1026 and docs/environment-variables.md:275 — Nominatim limiter ("lastStart + 1100 ms" / "at least 1100 ms apart" / "one at a time, at least 1.1 seconds apart")
- docs/architecture.md:317 ≈ docs/architecture.md:326, 333 — "manageable via the Admin UI at `/admin/queues`" stated three times within the DLQ section
- docs/architecture.md:325 ≈ docs/architecture.md:261 and docs/environment-variables.md:408 — database-queue polynomial backoff, default 16 attempts, dead-letter persistence
- docs/architecture.md:342-344 ≈ docs/architecture.md:349-351 — "in-process queue drops delayed messages" stated twice within 10 lines (sync-queue note, then delayed-actor-deletion note); same rule again at 1574-1579
- docs/architecture.md:351-352 ≈ docs/architecture.md:553 and docs/mastodon-api-compatibility.md:611 — `startActorDeletionSweep` runs every ten minutes as the in-process-queue fallback
- docs/architecture.md:527-528 ≈ docs/setup.md:94 and docs/maintenance.md:272 — "add a bucket lifecycle rule that aborts incomplete multipart uploads after a day or two" (verbatim in setup.md)
- docs/architecture.md:546-548 ≈ docs/features.md:68 — export limits ("one request per 7 days", ready archive expires after 7 days, one at a time)

### Stale
- docs/architecture.md:405 — `stepsCsv.ts` named as part of `lib/services/exports/` — checked: `git grep -n stepsCsv` → only `lib/services/accountArchive/stepsCsv.ts` (+test); the file is not under `lib/services/exports/` (that dir holds `csv.ts`, `accountExports.ts`). The parenthetical conflates the web-app CSV export dir with the account-archive step file.

### History / changelog text
- docs/architecture.md:313 — "`no-match` (from earlier builds)" — narrative about prior job statuses, not current behavior
- docs/architecture.md:325 — "matching Mastodon queue retry resilience" — justification aside, not a durable rule

### Long sections
- docs/architecture.md:379-570 (continues past slice) `### Account data export` (192+ lines in slice) — far over 80 lines; the single bullet "Resumable assembly" is 458-528 (71 lines) of zip/S3/checkpoint internals that belong in a design note, not durable reference
- docs/architecture.md:286-303 `#### Gallery albums` (18 lines) — lines are 500-1,200+ chars each; could be split (store / routes / pages / suggestions) though it is reference content
- docs/architecture.md:315-362 `#### Queues & DLQ Management` (48 lines) — backend reference tables/bullets; mostly must stay, but the internal repetitions noted above can go

### Task/PR-specific
- none

### Readability
- Walls of text: bullets at 293, 296, 299-300, 433-457, 458-528, 537-570 are single paragraphs of 500-2,000+ chars with parentheticals nested inside parentheticals (e.g. 483-492: S3 timeout reasoning three levels deep)
- Repeated "never/always" safety rules inside the export section (fail-closed, fail-open, compare-and-set) are interleaved with mechanics, making the invariant hard to find

### Slice summary
Queue backends, DLQ, and the account-data-export pipeline reference. Gallery-albums and export-limit rules are duplicated into features.md; the 7-day/lifecycle-rule notes are duplicated verbatim in setup.md and maintenance.md. The 71-line "Resumable assembly" bullet (458-528) is the single largest cut candidate — zip/S3 checkpoint internals that could move to a design note; roughly a third of the slice could go or move.

## docs/architecture.md lines 571-1117

### Duplicates
- docs/architecture.md:571-677 (Account data import) ≈ docs/features.md:69 — the import rules (10 GiB cap, 200,000-entry ZIP cap, one import per profile, three starts per 24h, `reply-uri-too-long`, quiet-import exceptions) are restated nearly verbatim in features.md's "Account archive import" bullet.
- docs/architecture.md:806-866 (Route Heatmap Tiles) ≈ docs/fitness-file-storage.md:136,203,758,865 — `buildHeatmapTileSource` gating, tile pyramid and clip-on-serve rules are explained in both files (fitness-file-storage.md carries the fuller version).

### Stale
none — spot-checked identifiers (`MAX_TILES_PER_REQUEST`, `ACTIVITIES_WEB_VITALS_SAMPLE_RATE`, `ACTIVITIES_WEB_VITALS_MAX_REPORTS_PER_MINUTE`, `ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE`, `proxyClientMaxBodySize`, `lib/utils/jpegExif.ts`, `lib/services/webVitals/schema.ts`, `scripts/maintenance/cleanupMediaStorage.ts`, `test/proxy.test.ts`): all exist.

### History / changelog text
- docs/architecture.md:811-813 — "A fitness route heatmap used to be one pre-simplified blob... `fitness_route_heatmap_pyramids` and `fitness_route_heatmap_tiles` replace it" — narrative of a past design ("used to", "replace it"); the durable rule is just the current pyramid design.
- docs/architecture.md:819-820 — "It still renders every row the pyramid cannot answer" and "The stored blob has not gone away" — migration-era framing; could state the fallback role directly.
- docs/architecture.md:790 — "(1 MiB of unclosed `<div>`s blocked the event loop for seconds)" — war-story rationale; the rule ("use the Tokenizer, not a tree parse") stands without it.

### Long sections
- docs/architecture.md:571-677 `#### Records, phases and recovery` + `#### Archive and document bounds` + `#### Quiet writes and imported data` (Account data import, ~207 lines total) — dense but reference-like; the skip-reason list (lines 640-660) and reason-code paragraphs could move to a table.
- docs/architecture.md:868-1046 `### Media & File Storage` (~179 lines) — one section covering upload routes, thumbnails, photo edits, masks, prune races and storage usage; could be split (upload path vs edit lifecycle) or trimmed of nested caveat chains.
- docs/architecture.md:1051-1062 `### Browser Web Vitals` (~12 bullet lines but ~450+ words) — single-paragraph bullets (Sending, Privacy allowlist) are walls of text; sub-bullets would help.
- docs/architecture.md:1063-1117 `## Database Schema (Simplified)` (55 lines) — ASCII diagram plus "Other tables" list; reference tables that must stay, though the retired-collection caveat at the end could live nearer the schema tables it concerns.

### Task/PR-specific
- docs/architecture.md:1047-1049 — "Offline-First PWA Launch & Timeline Caching" section body is a single self-pointer ("See [Offline-First PWA Launch & Timeline Caching](#agents-offline-first-pwa-launch-timeline-caching)") whose anchor does not resolve to a section inside this slice's file range; reads like a stub left from a section move.

### Readability
- docs/architecture.md:884-1046 — Media & File Storage paragraphs run 10-20 lines with multi-clause sentences ("Whatever fails after the first write reclaims what it stored, because a `medias` row is the only handle..."); nested caveat chains are hard to scan.
- docs/architecture.md:911-935 — the four "surfaces read the pyramid" bullets mix auth, caching, renderer fallback and format opt-in in one bullet each.

### Slice summary
Lines 571-1117 cover account data import, link preview cards, route heatmap tiles, media & file storage, and web vitals collection. Content is current and reference-quality; the main issues are extreme section length (Media & File Storage ~179 lines, Account data import ~207), walls-of-text paragraphs, and near-verbatim duplication of the import rules and heatmap rules in features.md and fitness-file-storage.md.

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

## docs/architecture.md lines 1313-1501

### Duplicates
- docs/architecture.md:1487 ("Every route that reads on the server has a `loading.tsx`... streamed loading boundary turns `redirect()`/`notFound()` into a 200") ≈ docs/architecture.md:1483 ("Each `/admin/*` route but `/admin` itself has a `loading.tsx`... a streamed loading boundary would turn the non-admin `redirect()` into a 200") — the loading.tsx-per-route rule and its redirect/200 rationale are stated twice within the slice.
- docs/architecture.md:1324 ≈ docs/architecture.md:1390 — the `text-primary-text` (not `text-primary`) rule for section-nav rows is stated in the Menu bullet (1324) and again in the SectionNavSelect bullet (1390), both pointing at the "orange-text rule under **Fitness Gear**" (which lives in AGENTS.md, not here).
- The Back/`BackLink`/`profileBack` rules (docs/architecture.md:1410) largely restate the `back` prop description at docs/architecture.md:1286 (same "Back to profile", `backDestination.ts`, x=40 row geometry).

### Stale
- docs/architecture.md:1383 — `ui_kits/web/GearKit.jsx` — checked: `ls ui_kits/web/GearKit.jsx` → "No such file or directory"; `git ls-files | grep -i uikit|GearKit` → no matches. The whole `ui_kits/` directory is gone; also referenced at docs/fitness-file-storage.md:1251 and docs/mastodon-api-compatibility.md:1403.
- docs/architecture.md:1320 — PR numbers `#2594`/`#2597` cited as the origin of the removed rail — history text, not durable rule.
- Verified present (not stale, for the record): `lib/components/section-nav-dropdown.tsx`, `section-nav-select.tsx`, `sectionNavActive.ts`, `sectionNavPattern.test.ts`, `lib/components/surface/*` (AddBar, Alert, EmptyState, FramedList, FormRow, SaveBar, ScreenSkeleton, SectionSkeleton, StatStrip, TableFrame, surfaceKitUsage.test.ts, alertOutsideFrame.test.ts), `lib/components/refresh-button.tsx`, `page-refresh-button.tsx`, `lib/components/photo-editor/engine/{adjustments,shaders,tiles}.ts`, `lib/client/mediaEdit.ts`, `MapLoadingOverlay`, `MOBILE_INSET_STACK_CLASS` in `lib/components/posts/feedLayout.ts`.

### History / changelog text
- docs/architecture.md:1320 — "(app PRs #2594 and #2597)" and "the rail ... its 'Back to …' row below `lg` and the wider `--container-section` column were removed on purpose" — narrative of a past removal.
- docs/architecture.md:1371 (PageSubnavProvider bullet) — "No settings-style section layout uses this any more (admin moved to `SectionLayout` to match the design system)" — change-log narrative; the "moved" rationale belongs in history.
- docs/architecture.md:1449-1448 region (### Surfaces intro) — "The kit began as the Fitness overview's own primitives, which Gallery already borrowed; they were promoted to neutral names" — origin story, not a durable rule.
- docs/architecture.md:1483 — "The stats page moved to `/admin/overview` ('Dashboard')" — relocation history.

### Long sections
- docs/architecture.md:1318-1401 `#### Section navigation...` / `#### Section sub-nav...` / `#### Mobile chrome...` run of bullets (~85 lines to 1403) — each bullet is a 300-500+ word wall mixing normative rules with implementation trivia (pixel offsets, class strings); could be split into a rule line plus a "why" sub-note, or tabled.
- docs/architecture.md:1449-1489 `### Surfaces (Shared Surface Kit)` — the component table rows (SaveBar, StatStrip, FormRow) are single 500-1000+ character cells; near-impossible to scan. Reference content that must stay, but should be split per-component or into subsections.

### Task/PR-specific
- docs/architecture.md:1320 — "the rail that Settings, Account & security and Admin had from `lg` (app PRs #2594 and #2597)" — PR-number history.
- docs/architecture.md:1483 — "the Dashboard (`/admin/overview`)" relocation note — describes a one-time move.

### Readability
- docs/architecture.md:1313-1501 overall — nearly every bullet is one unbroken 200-600 word paragraph (Mobile chrome, Z-order, the Admin kit bullet at 1483, the auth-pages bullet); nested caveats inside parentheses run three deep. Rule + rationale separation would fix most of it.
- docs/architecture.md:1314 — the hashtag-page bullet is a single ~150-word sentence with four parentheticals; the key rule ("keep the inline icon-and-title block") is buried at the end.
- The huge class-string enumeration in 1324 and 1483 (every prop, tone and file name in one sentence) duplicates what the linked source files already show; trimming to the invariant + file pointer would halve the section.

### Slice summary
This slice is the mobile-chrome and surface-kit portion of the UI architecture guide: section-nav rules, the shared Surface Kit table, kit-usage guard rules, and the start of the Photo Editor section. It is dense but accurate-looking reference material; the main cleanups are PR-number history (1320, 1371, 1483), the dead `ui_kits/web/GearKit.jsx` reference (1383), duplicated text-primary-text and loading.tsx rules, and breaking the wall-of-text bullets and the Surfaces table into scannable units.

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

## docs/architecture.md lines 2049-2710

Single `### Actor Profile & Deletion Federation` section (2049-2802, this slice is
its middle). Twenty-two top-level bullets covering profile editing/federation,
account migration (in/out), handle rename, and profile-link verification.

### Duplicates
- docs/architecture.md:2193-2284 ≈ docs/mastodon-api-compatibility.md:1171 — the
  inbound `Move` handling is described twice at near-equal depth: cooldown
  (`move_in_progress`), alias verification, `MoveFollowerJob`/`MoveRelationshipsJob`
  carry-over rules, silenced-vs-unsilenced local followers, deterministic ids. The
  compatibility doc even ends "Details in architecture.md", yet restates nearly all
  of it. Checked: `git grep -nF 'move_in_progress'` → both files.
- docs/architecture.md:2666-2674 ≈ docs/architecture.md:1230 — `VerifyProfileLinksJob`
  fetch mechanics (`safeRemoteFetch`, 5 s + 5 s per hop, 1 MiB body, HTML only, two
  redirects) stated in both places in the same file.
- docs/architecture.md:2686-2710 ≈ docs/mastodon-api-compatibility.md:1295 —
  `fields[].verified_at` semantics: single-https-URL rule, `rel="me"` token matching
  profile URL/actor id/replaced handles, `requires_verification?` re-queue,
  `linksCheckedAt` never federated, "at most four fields", "verified link is not
  checked again until its value changes" — restated nearly verbatim.
- docs/architecture.md:2410-2481 (moved-account rules: posting refused, follow
  refused, scheduled statuses, fitness imports) ≈ docs/features.md:12 — the same
  rules (30-day cooldown, `PUT /api/v1/scheduled_statuses/:id` recovery, "A performed
  move is not undone", fitness backing status) restated in the feature list.
- docs/architecture.md:2488-2554 (rename, 30-day cooldown, handles reserved forever,
  rejected sign-up frees them, 308 redirects, remote rename via WebFinger) ≈
  docs/features.md:13 — same rules restated.
- docs/architecture.md:2490-2503 (createdWhileMoved / `isIsolatedFromFitnessImport`
  isolation rules, direct-with-no-mentions case, Wahoo revision) ≈
  docs/fitness-file-storage.md:11 — near-verbatim duplication of the whole paragraph.

### Stale
- none — every file path, symbol, route and migration id sampled exists:
  `lib/services/actors/actorUpdate.ts`, `hasFederatedProfileChange`,
  `lib/jobs/moveActorJob.ts`, `sendMoveJob.ts`, `isOutgoingMoveAuthorized`,
  `lib/services/accounts/migration/outgoingMove.ts`, `actorMigration/queries.ts`,
  `movedAccount.ts`, `actor/deletion.ts`, migrations `20261024131756` /
  `20261025141323`, `actorHandle/queries.ts`, `renameStatusUrlsJob.ts`,
  `getLocalHandleRedirect`, `lib/utils/http-headers/localHandleRedirect.ts`,
  `confirmActorHandle`, `formatProfileFieldValue`, `profileFieldVerification`,
  `queueProfileLinkVerification`, `fitnessImportIsolation`,
  `servedDomain/queries.ts`, `profile-links/html.ts`, `verifyProfileLink.ts`,
  `app/api/v1/accounts/migration/route.ts`, `interaction_policy/route.ts`,
  `settings/profile/page.tsx`, and symbols `rejectPendingAccount`,
  `updateActorWithPrevious`, `getPersistableProfile`, `publishActorUpdate`,
  `MAX_PROFILE_FIELDS` (checked via `git ls-files | grep` and `git grep -nF`);
  `htmlparser2` is in package.json.

### History / changelog text
- docs/architecture.md:2391-2392 — "Both used to refuse an origin with a private
  key. Now a local origin…" — past-behaviour narrative; state current behaviour only.
- docs/architecture.md:2102-2104 — "replacing profile editing from the former
  General page and the old Featured hashtags settings tab" — migration-history note
  about removed UI; the "former/old" framing is changelog, not reference.
- docs/architecture.md:2413-2415 — "The former 'General' page is removed: settings
  are split into focused pages" — same removed-UI history pattern.
- docs/architecture.md:2543-2544 — "keeps its handles reserved (a behaviour
  change)" — "(a behaviour change)" is a changelog aside.
- docs/architecture.md:2679 — "or — since the in-place rename —" — "since X"
  history marker; the rule alone suffices.

### Long sections
- docs/architecture.md:2049-2802 `### Actor Profile & Deletion Federation` (754
  lines, this slice is 662 of it) — far over any reasonable section size; should be
  split into subsections (Profile editing / Account migration / Handle rename /
  Profile links), each of which is still large.
- docs/architecture.md:2193-2284 inbound `Move` bullet (92 lines) — split; the
  MoveFollowerJob mechanics alone are ~50 lines.
- docs/architecture.md:2096-2171 Edit profile page bullet (76 lines) — mixes page
  structure, unsaved-changes guard browser quirks, and actor-check UX; split.
- docs/architecture.md:2410-2481 clearing/posting/deletion bullet (72 lines) —
  mixes DELETE semantics, moved-account API matrix, and fitness-import isolation;
  the isolation part duplicates fitness-file-storage.md and could go entirely.
- docs/architecture.md:2285-2352 outgoing move + recording bullets (68 lines) —
  dense status-code narrative; could be a table of error → condition.
- docs/architecture.md:2488-2554 rename bullets (67 lines) — reference-dense but
  readable; keep, trim the defensive asides.

### Task/PR-specific
- none — no checklists, PR numbers, or single-task instructions in this slice.

### Readability
- Bullets routinely run 60-90 lines as a single sentence chain with nested
  parentheticals three levels deep (e.g. 2136-2150 on the Navigation API and
  Chromium's interaction requirement); sentences of 80+ words are normal.
- Repeated defensive hedging: "best effort", "never fails the request",
  "as Mastodon does/does not", Mastodon parity asides appear dozens of times and
  often duplicate the adjacent normative statement.
- The slice mixes four audiences in one section: federations wire format, API
  status-code contracts, UI behaviour (toasts, focus, container queries at 860px,
  sticky bars), and DB schema — none separated by subheadings.

### Slice summary
Deep reference material for profile federation, account migration and handle
rename; all checked symbols/paths are current, so nothing is stale. The bulk of
the trim comes from duplication: the Move, moved-account and rename bullets
restate (or are restated by) mastodon-api-compatibility.md, features.md and
fitness-file-storage.md — roughly 150-200 lines here could shrink to links. The
single 754-line section needs subheadings and its 60-90-line bullets split.

## docs/architecture.md lines 2711-2901

### Duplicates
- docs/architecture.md:2816 (`deleteSessionsWithTokenDetach`, `lib/database/domains/account/sessions.ts`) ≈ docs/maintenance.md:1278 — the session-delete helper and its token-detach rationale are explained in both files; one should link to the other.
- docs/architecture.md:2860 (soft `revoked` column not honoured, sign-out does not sign apps out) ≈ docs/maintenance.md session-delete guidance — same Mastodon-comparison rule restated across the two files.
- docs/architecture.md:2858 (`OAUTH_ACCESS_TOKEN_SLIDE_INTERVAL_SECONDS`) — the sliding-expiry window and `database.extendOAuthAccessToken` mechanics overlap with the access-token guard descriptions elsewhere in this same file's OAuth sections (in-file duplication rather than cross-file).

### Stale
- none — spot-checked symbols against the repo and all exist (`schemaCompleteness.test.ts`, `errorURL.test.ts`, `kyselyAdapter*.ts`, `repointUnconfirmedAccountEmail`, `isAccountConfirmationPending`, `deleteSessionsWithTokenDetach`, `selectAccountActor`). No file paths, scripts, env vars or commands in this range were found missing.

### History / changelog text
- docs/architecture.md:2796 ("the better-auth 1.7 upgrade shipped a green suite while every OAuth sign-in 500'd") — war-story narrative of a past incident; the rule ("diff the declared schema") survives without it.
- docs/architecture.md:2826 (Database Joins section, long passage on 1.6.x behaviour: "the flag lived at `experimental.joins` until better-auth 1.7 moved it here… every signed-in user was silently logged out") — upgrade history, not a durable rule.
- docs/architecture.md:2858-2859 ("The pre-better-auth OAuth server's `tokens` table had a sliding session; the move to better-auth … dropped it") — migration history explaining why the slide exists; could compress to one sentence.
- docs/architecture.md:2896-2900 (Unconfirmed Account section, "round 6 moved it… that inversion was written here once and is what this sentence replaces") — self-referential changelog/meta commentary about earlier edits to this very doc.

### Long sections
- docs/architecture.md:2842-2863 `OAuth Access Token Sliding Expiry` (~12 bullets spanning into Auth Error Page heading at 2864) — dense but mostly durable rules; could split "guard/slide mechanics" from "revocation rules".
- docs/architecture.md:2876-2901 `OAuth Grants Must Resolve an Actor` — reference-table-free prose; bullets are individually durable but each runs 5-10 lines; splitting actor-resolution from app-token detection would help.

### Task/PR-specific
- docs/architecture.md:2811 ("Preflight the real database before a 1.7.3 rollout", "Drain and remove every 1.7.2 auth-serving instance", "route this as a coordinated cutover") — deployment-runbook steps for one release; the durable kernel (nullable `issuer`, duplicate `(provider, providerId)` check) is fine, the cutover sequencing belongs in the runbook the bullet itself points to.
- docs/architecture.md:2814 (Plan rollback separately; restore issuer values before handing traffic back) — same release-specific cutover plan.

### Readability
- Paragraph-bullets run 8-14 lines each (e.g. the schemaCompleteness bullet at 2796, the adapter-rules bullet at 2816, the re-point bullet at ~2897); a reader cannot scan the rule from the bold lead-in alone.
- Nested caveats inside caveats (parentheticals on parentheticals, e.g. the ProfileFieldsBlock "Where it shows" bullet at 2722-2735 and the re-point bullet) bury the operative rule; sub-bullets would fix it.
- Repeated "never/always" emphasis (bold **never**, *not*, caps NEVER) appears in nearly every bullet of the Auth Error Page and Sliding Expiry sections, diluting which rule is actually the hard one.

### Slice summary
Lines 2711-2901 are durable contributor rules for better-auth, OAuth grants, actor resolution, and the auth error page; almost nothing is disposable except the 1.7.3 cutover/rollback runbook text and two war-story passages (~15 lines total). No stale references were confirmed. The main defect is bullet length: single bullets carrying 10+ lines of mechanism, rationale and incident history that could be split into rule + note.

## docs/architecture.md lines 2902-3458

Slice covers three `###` sections: "Review: Runtime vs. build-time configuration" (2905-2946), "Review: Client components & data flow" (2948-3252), "Review: Page chrome, layout & accessibility" (3254-3457).

### Duplicates
- docs/architecture.md:2950 ≈ CONTRIBUTING.md:250 — "never call `fetch()` directly" client-API rule (named functions in `lib/client`) stated in both.
- docs/architecture.md:2968-2984 ≈ docs/fitness-file-storage.md:598-604 — same hydration/timezone rule: render UTC until `useHasHydrated`, never paper over with `suppressHydrationWarning`, `ActivityStartTime` as reference.
- docs/architecture.md:2922-2928 ≈ docs/setup.md:376 — optional SDKs in `packages/*`, `dynamicImport`, type stubs in `lib/types/optional-modules.d.ts` stated in both (setup.md adds workspace names).
- docs/architecture.md:3145-3160 ≈ docs/features.md:15 — combined self-replies mechanics (10-minute gap, one action bar, per-part ⋯ menus, "Show as separate posts") restated condensed in the features list.
- docs/architecture.md:3277-3289 ≈ docs/fitness-file-storage.md:1247-1258 — sticky first column via `STICKY_COLUMN`/`STICKY_CLICKABLE_COLUMN`, `bg-background` surface, opacity-on-cells rule restated in depth in both.
- docs/architecture.md:3312-3321 ≈ docs/fitness-file-storage.md:1233-1244 — orange text = `text-primary-text`, `--primary` is 3.37:1, `--primary-text` clears 4.5:1; fitness-file-storage points back here for exceptions but restates the core rule.
- docs/architecture.md:3285-3286 ≈ AGENTS.md:318 — `SectionNavDropdown` at every width, never a rail beside content; AGENTS.md labels the repeat as deliberate, but it is a full second statement.
- docs/architecture.md:3113-3115 ≈ docs/mastodon-api-compatibility.md:1456-1458 — `deferUntilClosed` semantics (runs from `onCloseAutoFocus`, suppresses Radix focus restore) explained in both.
- docs/architecture.md:3201-3203 ≈ docs/architecture.md:3205-3209 — internal: "React Compiler does not memoize per `.map` iteration, so list rows still need `memo`" appears twice in adjacent bullets.

### Stale
- none — every file, symbol, env var, test and package referenced in the slice was checked and exists (`lib/config/photoEditor.ts`, `lib/utils/http-headers/csp.ts`, `selfThreadModel.ts`, `combinedThreadModel.ts`, `post-options-menu.tsx` at `lib/components/post-box/`, `read-only-stats.tsx`, `optional-modules.d.ts`, `test/feed-row-*.test.ts`, `gearUi.ts`, `reactCompiler`/`babel-plugin-react-compiler`, `BUILD_STANDALONE` in Dockerfile/next.config.ts, the six optional-SDK workspace packages, `.oxlintrc.json` frozen legacy list at line 231).

### History / changelog text
- docs/architecture.md:3248-3250 — "Never hand-roll sticky breakout headers (e.g. 75px hand-rolled headers cause 4px layout shifts)" — rationale from a fixed bug.
- docs/architecture.md:3249-3250 — "No reintroduced `max-w-2xl`/`max-w-4xl` split, `contentWidth` prop, or `data-layout-width`" — regression-guard wording naming APIs that no longer exist (checked: `git grep contentWidth|data-layout-width -- app lib` → no hits).
- docs/architecture.md:3159-3160 — "keeps its collapsed first post, expander and last post exactly as before" — change-relative phrasing.
- docs/architecture.md:3124-3127 — "a bordered box fitted without it is 2px short and scrolls its last line away" — past-bug narrative as rationale.

### Long sections
- docs/architecture.md:2948-3252 `Review: Client components & data flow` (305 lines) — far over 80; mixes data-flow rules, lazy-loading/`createPreloadable`, combined-post models, composer toolbar/geometry, CSS containment, React Compiler and fitness-gear rules. Could split into at least 4 subsections; the combined-posts block (3145-3183) alone is ~40 lines of dense spec.
- docs/architecture.md:3254-3457 `Review: Page chrome, layout & accessibility` (204 lines) — over 80; mixes layout/navigation rules, color-token contracts (3305-3378) and per-component styling. Could split layout vs color tokens vs form primitives.
- docs/architecture.md:2905-2946 `Review: Runtime vs. build-time configuration` (42 lines) — under limit; dense but cohesive reference, keep.

### Task/PR-specific
- docs/architecture.md:3121-3135 — pixel-level post-action-row layout rationale (`-ml-13`, `gap-1`, `ml-auto`, 400px `ResizeObserver` threshold) reads as a single PR review frozen into the architecture doc.
- docs/architecture.md:3164-3172 — combined-post UI minutiae (exact aria-label strings "More actions for part 2 of 4", "2 of 4 · 15m" label, focus behavior after menu closes) is component-spec detail better owned by the components/tests.
- docs/architecture.md:3395-3403 — per-button dark-mode backgrounds enumerated one by one (scroll-to-top pill, refresh button, announcements button, "N new posts" pill) — snapshot-level styling detail.

### Readability
- Several bullets are single sentences of 15-25 lines with nested parentheticals (e.g. 2968-2984 hydration, 3013-3032 `createPreloadable`, 3147-3152 combined-blocks rule); hard to scan and easy to misread.
- The "only when the profile has a panel that shows it (a Media or Gallery tab, or the media-only gallery)" condition is repeated verbatim at 3020 and 3041-3043.
- The color-token block (3305-3345) interleaves WCAG math, hex values, design-history notes ("the design's Destructive Text") and usage rules in single paragraphs; a table would compress it.

### Slice summary
Dense, well-maintained contributor rules; no stale references found. Main costs: two ~200-300-line `Review:` sections that each bundle 4-5 unrelated subsystems, ~9 confirmed duplications (mostly with docs/fitness-file-storage.md, CONTRIBUTING.md, setup.md, features.md, AGENTS.md), and several PR-review-grade pixel/spec details that could move to component-level docs. Roughly a third of the slice is duplicated elsewhere or is component-spec detail rather than architecture.

## docs/architecture.md lines 3459-4033

### Duplicates
- docs/architecture.md:3589-3610 ("Review: Unconfirmed accounts & app tokens", the `OptionalOAuthGuard` downgrade and the `unconfirmedAccount: 'allow'` single-consumer rule) ≈ docs/architecture.md:2889-2895 — the same unconfirmed-account refusal, downgrade-to-anonymous, and single-carve-out rules are stated at full length in two places in this file (slice version is the condensed one).
- docs/architecture.md:3687 vs 1298/1429/1480 — `MOBILE_FEED_SURFACE_CLASS` feed-framing geometry is described at line 3687 and again in the layout sections at 1298, 1429 and 1480.

### Stale
- none — spot-checked symbols and paths against the repo and all exist: `scripts/mock/renderEmailPreviews.ts`, `buildPreviews`, `getServedLinkDomain`, `resolveStatusPreviewUrl`, `extractPreviewUrl`, `recordLinkPreviewFailure`, `MOBILE_FEED_SURFACE_CLASS`, `useMediaStripScroll`, `getMediaGeometry`, `isRenderableAttachment`, `isActorConfirmationPending`, `surfaceKitUsage.test.ts`, `docs/maintenance.md`.

### History / changelog text
- docs/architecture.md:3572-3574 — "two attempts at that bound shipped wrong in opposite directions" (past-bug narrative inside the verifiedAt rule).
- docs/architecture.md:3663 — "This has bitten twice." (incident history, not a rule).
- docs/architecture.md:3757 — "the branch this replaced cropped every portrait photo to a full-width 16:9" (old-implementation history).
- docs/architecture.md:3895 — "that is precisely how `sendUndoAnnounceJob` shipped broken" (past-bug narrative).

### Long sections
- docs/architecture.md:3684-3876 `Review: Post media layout` (193 lines) — several walls of text; the media-strip/bleed and lightbox bullets could be split into subsections or tables.
- docs/architecture.md:3908-4002 `Review: Link preview cards` (95 lines) — could be split (caching vs extraction vs parser divergence).
- (section 4003 `Offline-First PWA Launch & Timeline Caching` begins at the slice boundary and continues past it.)

### Task/PR-specific
- none found — the slice is review-rule reference content.

### Readability
- 3564-3642 `Review: Unconfirmed accounts & app tokens` is 79 lines of dense single-paragraph bullets nesting three interlocking rules (verification columns, guard dispositions, migration history); a wall of caveats.
- 3684-3876: one bullet on media bleed spans ~30 lines with mid-sentence bold switches; the corner-rounding bullet re-explains tailwind-merge resolution in prose.

### Slice summary
This slice is the tail of the "Review:" rule catalog (surfaces, logging, auth, emails, media layout, link previews) plus the first lines of the offline-PWA section. It is almost entirely durable rule content; the cleanup opportunities are the duplicated unconfirmed-accounts rules (3564-3642 vs 2889-2895), four history-narrative sentences, and splitting the two 95+ line sections.

