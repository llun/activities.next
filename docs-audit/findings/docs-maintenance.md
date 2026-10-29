# Findings: docs/maintenance.md

Generated slice by slice by GLM-5.3-flash from origin/main aa368a596 (brief: ../findings-brief.md).

## docs/maintenance.md lines 1-554

### Duplicates
- docs/maintenance.md:15 ≈ docs/postgresql-setup.md:63 ≈ docs/sqlite-setup.md:39 — "`yarn migrate` prints the database it resolved … `yarn migrate:status` lists the applied and pending migrations without writing" is restated in both setup guides and again here.
- docs/maintenance.md:15, 22, 29 — "it does not create a missing SQLite file" / "is not created" is stated three times inside the same handover section.
- docs/maintenance.md:78 ≈ docs/maintenance.md:176 — "Always run `--dry-run` first" warning stated twice within the Media Storage Cleanup section (body and Safety).
- docs/maintenance.md:529, 539, 551 — "Defaults to `testuser` … Run after `createMockUser.ts`" repeated for three mock scripts; CONTRIBUTING.md:1125 also covers the createMockUser invocation.
- docs/maintenance.md:56 ≈ docs/architecture.md:321 — `scripts/maintenance/runQueueWorker.ts` described in both (brief cross-reference in architecture.md; low priority).

### Stale
- docs/maintenance.md:381-421 — "Two one-off repair scripts" but three subsections follow, and one of them is in this checkout: `backfillMediaSortAt.ts` — checked: `git ls-files scripts/maintenance/backfillMediaSortAt.ts` → exists, and `git ls-files migrations | grep 20261024160234` → `migrations/20261024160234_add_media_sort_at.ts` exists. So the "Media Sort Date Backfill" subsection (401-412) is misplaced under "Repairs that stay with v1.192.34"; its script and migration are present here.
- docs/maintenance.md:393 — `scripts/maintenance/backfillPublicIds.ts` — checked: `git ls-files scripts/maintenance | grep backfillPublicIds` → empty. Consistent with the doc's own claim that it is not in this checkout, so not stale; noted only to confirm the claim.
- docs/maintenance.md:414 — `scripts/maintenance/rewriteNotificationIds.ts` — checked: `git ls-files scripts/maintenance | grep rewriteNotificationIds` → empty. Same as above; the doc itself says it left with v1.192.34.
- All other scripts/commands verified present, so not reported: `scripts/maintenance/bundleReport.ts`, `runQueueWorker.ts`, `cleanupMediaStorage.ts`, `mediaEditReferences.ts`, `backfillGalleryLookups.ts`, `rebuildSearchIndex.ts`, `fixAttachmentUrls.ts`, `scripts/backup/{downloadProductionArchive,restoreProductionArchive,productionArchive,productionArchive.database.test,exportActorArchive}.ts`, `scripts/mock/{createMockUser,createMockStatuses,createMockFitnessData,createMockFitnessCalendarData}.ts`, `scripts/run.cjs`, `migrations/baseline`, `lib/database/{connection.ts,migrate}`, `lib/services/accountArchive/actorArchive.ts`; package.json scripts `migrate`, `migrate:status`, `migrate:unlock`, `migrate:down`, `bundle:report`, `build`, `analyze`, `search:reindex` all present (`yarn knex` is absent here but the doc only invokes it "from a v1.192.34 checkout", so not stale). Env vars `ACTIVITIES_MEDIA_STORAGE_PATH`, `ACTIVITIES_MEDIA_STORAGE_BUCKET`, `ACTIVITIES_SECRET_PHASE`, `ACTIVITIES_DATABASE_CLIENT`, `SEARCH_REINDEX_BATCH_SIZE` and symbols `PUBLIC_ROUTE_JS_BUDGETS`, `openArchiveDatabase`, `getKnownMigrationNames` all found via `git grep`. Routes `/api/v1/media/:id/lookups` and `/api/v1/account/archives` exist (`app/api/v1/media/[id]/lookups/route.ts`, `app/api/v1/account/archives/route.ts`).

### History / changelog text
- docs/maintenance.md:5-30 — the whole "Upgrading past the Knex handover" section is release-specific narrative for one handover ("From this release on, migrations run with Kysely instead of Knex"), with v1.192.34 mentioned ~10 times; once every deployed database is past the handover it can shrink to a short note.
- docs/maintenance.md:245 — past-bug narrative: "node-postgres's `Date` would drop a timestamp's microseconds …" and "Archives written before this held ISO strings".
- docs/maintenance.md:248 — past bug: "(Before this, every SQLite restore failed on `search_documents_fts_idx`.)"
- docs/maintenance.md:337-339 — background story for a flag default: "this otherwise ran to days for an account whose posts point at hosts that drip bytes".
- docs/maintenance.md:383-385 — history framing: "Two one-off repair scripts went with the Knex migrations whose rollouts they finished".
- docs/maintenance.md:404-406 — version-comparison note: "A subject `no-match` written by an earlier build no longer clears a place".

### Long sections
- docs/maintenance.md:5-30 `## Upgrading past the Knex handover` (26 lines) — short in lines but two ~230-word paragraph walls (lines 11, 29); could be split into a status table plus a short procedure.
- docs/maintenance.md:65-177 `## Media Storage Cleanup` (113 lines) — the Examples subsection (118-157) repeats two near-identical env-export blocks; could collapse to one example plus a variable table.
- docs/maintenance.md:251-380 `## Actor Archive Export` (130 lines) — the Options bullets (306-354) are multi-paragraph essays per flag; the SSRF/fetch-budget detail could move to a sub-heading or the script's `--help`.
- docs/maintenance.md:243-250 `#### How the database travels` (8 lines) — bullets of 150-300 words each (line 245 is one ~300-word bullet); needs splitting.

### Task/PR-specific
- docs/maintenance.md:5-30 — handover checklist tied to one release (v1.192.34 → Kysely); release-specific, will be dead weight once the fleet is migrated.
- docs/maintenance.md:541-553 — mock calendar seed defaults (`--anchor 2026-10-04 --time-zone Europe/Amsterdam`) read like a one-off QA session's parameters baked into durable docs.

### Readability
- docs/maintenance.md:261-289 — the "CLI versus the user export" blockquote drifts into import-sweep internals (`imports/` prefixes, lease expiry, multipart cleanup) unrelated to the operator export command it sits under.
- docs/maintenance.md:29 — single paragraph mixes lock behaviour, concurrency, kill-recovery and unknown-schema recovery; heavy nested caveats throughout the file ("— and, when the local database already has migrations applied, those too").
- Repeated "always/never" safety imperatives (dry-run twice, "refused before anything is written" twice at 29 and 30-31 area) could be one shared safety note.

### Slice summary
Lines 1-554 are the operator-facing half of the maintenance guide: migration handover, bundle report, queue worker, media cleanup, production archive backup/restore, actor export, backfills, search reindex, URL fix, mock seeders. Nearly everything referenced still exists; the real cleanup targets are (1) the misplaced Media Sort Date Backfill under "Repairs that stay with v1.192.34", (2) the release-specific handover section once the handover ages out, and (3) ~80-100 lines of duplicated examples, repeated warnings and past-bug narrative that could be cut or condensed.

## docs/maintenance.md lines 555-1016

### Duplicates
- docs/maintenance.md:659 ≈ docs/maintenance.md:727-731 — `backfillFitnessRouteData.ts` "populates `fitness_file_route_data` for an actor's completed fitness files so that route-data requests resolve from database cache instead of downloading and re-parsing files" appears nearly verbatim twice, once as a Note at 659 and again as its own #### section at 727 (which also repeats the `--force` / `--dry-run` / skip behaviour from 659). Also ≈ docs/fitness-file-storage.md:434, which re-describes the same script's flags.
- docs/maintenance.md:655 ≈ docs/maintenance.md:725 — "a rebuild is heavier than the queued-job count suggests" (recreateFitnessRouteHeatmaps tile-pyramid warning) stated twice in the same slice; the 727 section even says "read its note above first".
- docs/maintenance.md:653 ≈ docs/maintenance.md:903-908 ≈ docs/fitness-file-storage.md:444 — the `.env.local` shadows `.env.production` even under `NODE_ENV=production` warning appears three times; 653 is a one-line note, 903-908 a full "Important" block, fitness-file-storage.md a third copy.
- docs/maintenance.md:661-686 ≈ docs/fitness-file-storage.md:297,437 — `backfillFitnessDevices.ts` dry-run-by-default/`--apply`/idempotent behaviour described in both files.

### Stale
none — every script, file, symbol and migration named in the slice was verified: `git ls-files` found all 24 scripts (`scripts/mock/createWebVitalsFixtures.ts`, `renderEmailPreviews.ts`, `scripts/maintenance/manageAdminRole.ts`, `importRemoteStatus.ts`, `verifyDockerImages.ts`, `backfillMediaSortAt.ts`, `scripts/run.cjs`, and all 15 `scripts/fitness/*.ts`), `grep '"migrate"' package.json` found the `yarn migrate` script, `git ls-files` found all referenced lib paths and linked docs, and `git grep` found `ACTIVITIES_PHOTO_MASK_MODEL_BASE_URL`, `PRESIGNED_ANALYSIS_MAX_BYTES`, `GALLERY_INDEX_CAP`, `markMediaUploadVerified`, `resolveGalleryGear`, `createNoteJob`, `actorVisibleStatusIds`, `medias_actorId_sortAt_id_idx`, `add_media_gallery_added_at` and migration `20261024160234_add_media_sort_at`.

### History / changelog text
- docs/maintenance.md:744 — "Gear tracking arrived after most activities did" (narrative opener; the durable instruction is the next sentence).
- docs/maintenance.md:693 — "New imports are normalized at parse time, so this script is only for history imported before that rule" (borderline: explains why the script exists, but is also durable operational info).
- docs/maintenance.md:1014 — "formerly Recent; `/gallery/recent` permanently redirects" (rename history).

### Long sections
- docs/maintenance.md:742-861 `#### Backfilling gear onto activities imported before gear tracking existed` (120 lines) — one section mixing matcher semantics, refusal rules, a 45-line JSONC example, the converter script and a defaultSports note; could be split (script behaviour vs gear-import JSON format vs converter).
- docs/maintenance.md:995-1016 `### Media Details, EXIF and Gallery Settings` (22 lines inside slice, section continues past 1016) — individual bullets are 200-400+ word walls (EXIF line 1001-1002, presigned path, gallery routes, photo-edit routes); must stay as reference but needs sub-structure.

### Task/PR-specific
none.

### Readability
- docs/maintenance.md:995-1016 — the Media Details section's bullets are single-line paragraphs of extreme length with deeply nested parentheticals; hard to scan despite being accurate reference.
- docs/maintenance.md:631-660 — the fitness script block lists 11 commands, then the per-script Notes restate flags already shown in the commands; the two `####` deep-dive sections (661, 687) duplicate what the Notes say, so the same script's behaviour is spread over up to three places in the slice.

### Slice summary
Slice covers "Other Scripts" (Web Vitals fixtures, email previews, admin role, a large fitness/Strava/Wahoo maintenance block, importRemoteStatus, Docker image verification) plus the start of the "Contributor rules" gallery/EXIF reference. No stale content found; the main cleanup is collapsing the duplicated backfill/rebuild/env-shadow warnings (each stated 2-3 times) and splitting the 120-line gear-import section. Roughly 40-50 lines of the slice are redundant restatements.

# docs/maintenance.md lines 1017-1282

## Duplicates

- docs/maintenance.md:1018 ≈ docs/maintenance.md:1259 — the `attachments.mediaId` / `medias.id` both-integer join (`galleryMediaIdRef`, `toAttachmentMediaId`, `galleryMediaQueryPlan.test.ts`) is stated nearly verbatim twice, once in the gallery bullets and once under Database Compatibility Guidelines.
- docs/maintenance.md:1026 ≈ docs/maintenance.md:1151 — the threatened-species fail-closed rule is given in full in the gallery bullet ("It fails closed…") and restated in "What the gallery lookups disclose to third parties" ("Threatened-species hiding fails closed…").
- docs/maintenance.md:1167 ≈ docs/maintenance.md:1171-1172 — the `backfillMediaBlurhash.ts` / `isOwnAuthority` / `#1559`-`#1570` story appears in both the "stored media URL" bullets; the URL-host half repeats the other's PR narrative.
- docs/maintenance.md:1174 ≈ docs/maintenance.md:1175 — the read-only image field / echo-rule rationale overlaps heavily between the "empty value clears" bullet and the "matches stored = no change" bullet.
- Cross-file: docs/maintenance.md:1026 ≈ docs/features.md:78 (smart subjects / threatened-species hiding described in both; features.md is the user-facing twin, so likely intentional).

## Stale

- docs/maintenance.md:1167, 1171, 1172 — `scripts/maintenance/backfillMediaBlurhash.ts` — checked: `git ls-files | grep -i backfillMediaBlurhash` → no match; the script no longer exists, yet 1167 presents it as a live caller and 1171 quotes its `isOwnAuthority` doc comment as a current reference.
- docs/maintenance.md:1172 — `isOwnAuthority` — checked: `git grep -n isOwnAuthority` outside this doc → no hits; the doc itself says #1570 deleted it, so the quoted "former consumer" narrative is dead weight, not a stale claim.
- docs/maintenance.md:1194 — `fitness-files/path.ts` ("it replaced the near-identical `fitness-files/path.ts`") — checked: `git ls-files | grep` → file gone; accurate as history but only meaningful as history.
- No other stale references found: spot-checked ~30 named symbols/files (`normalizeBlurhash`, `isTraversingStoragePath`, `resolveStorageFilePath`, `redactStorageError`, `toMediaRowId`, `deleteSessionsWithTokenDetach`, `findActorRowByUsername`, `GALLERY_INDEX_CAP`, `EXTENSION_BY_CONTENT_TYPE`, `backfillGalleryLookups.ts`, `cleanupMediaStorage.ts`, `storagePath.ts`, migration `20260822000000_reorder_status_announce_index`, …) — all exist.

## History / changelog text

- docs/maintenance.md:1130 — "the local driver had this gap for as long as both existed" — past-bug narrative inside the video-preview rule.
- docs/maintenance.md:1163 — "the predicate it replaced compared `hash.trim()` … was approved on the trimmed copy" — story of a fixed bug.
- docs/maintenance.md:1167 — "`backfillMediaBlurhash.ts` hit the same bug independently and fixed it first, in #1559 … #1569 … #1570" — PR-by-PR narrative.
- docs/maintenance.md:1172 — "reintroduced by #1560", "was deleted by #1570" — change log.
- docs/maintenance.md:1179 — "#1569's traversal fix moves URLs INTO this guard's branch" — PR history.
- docs/maintenance.md:1183 — "three source-text spellings of the guard were tried first and review defeated each" — review-round narrative.
- docs/maintenance.md:1193 — "a review of PR #1570 had to narrow a comment in `mediaFileUrl.ts`" — PR history.
- docs/maintenance.md:1194 — "`copyProfileImage` is the one migration that fixed nothing" — migration history.
- docs/maintenance.md:1201, 1203, 1204 — "Three review rounds each found one member", "removed once as unreachable and had to be put back", "Five review rounds each broke a cleverer version" — review archaeology.
- docs/maintenance.md:1214 — "it used to put all of that straight back" — past-tense bug story.
- docs/maintenance.md:1225, 1229-1230 — "Production's plan on 2026-08-22: 8,973 buffers / 18.4 ms", "3.8 million times since 2026-03-09" — dated measurements that will rot.
- docs/maintenance.md:1242 — "'0x10' and '0b101' used to resolve media 16 and 5 … all now 404" — before/after changelog.
- docs/maintenance.md:1254 — "`GET /api/v1/passkeys` used to treat a SQLite value as text and threw" — past-bug note.

## Long sections

- docs/maintenance.md:1043-1116 `### Deleting Media a Post Uses` — 74 lines; six bullets, several 300-500 words, interleaving three routes' delete semantics, album cascade cleanup and edit-file cleanup. Could be split into "which route allows what" vs "what the cleanup removes".
- docs/maintenance.md:1125-1136 `#### Uploaded file names are untrusted input` — 12 lines but bullets of 200-400 words each.
- docs/maintenance.md:1154-1160 `#### Video preview frames and automated alt text` — 7 lines but one ~700-word bullet on ffmpeg memory limits.
- docs/maintenance.md:1165-1189 `#### A stored media URL is only ours if the host says so` — 25 lines, single bullets of 300-600 words (1173 is one ~350-word sentence chain).
- docs/maintenance.md:1234-1280 `### Database Compatibility Guidelines` with `#### Kysely` — 47 lines where 1246 (migrations) and 1250 (connection) are single ~300-word paragraphs; the Kysely half mixes a tutorial, a dialect reference and per-helper cross-references.
- Note: none of these exceed 80 raw lines; the problem is bullet length (walls of text with nested caveats), not section count. Reference tables are not the issue here.

## Task/PR-specific

- docs/maintenance.md:1225-1230 — the composite-index section is one investigation's record: dated production plans (2026-08-22), a seed matched "to within ~2%", and a correlation reading of 0.787/-0.181. The durable rule ("order composite indexes by what every caller constrains"; "measure on a seed, never DROP INDEX on production") is two lines; the rest is post-mortem.
- docs/maintenance.md:1186 — "the SPACE half of the residual is still open … unbuilt, not rejected" — a TODO for unbuilt work sitting in a durable security section.
- docs/maintenance.md:1172 — "whether Apple treats `*` as a glob there is unverified … Establish that before sweeping it" — an open action item embedded in reference text.

## Readability

- docs/maintenance.md:1026 — a single bullet of roughly 1,100 words enumerating every GBIF answer shape with worked examples ("Tiger", "Pangolin", the giant panda). The rule is three sentences; the examples could be a list or a table.
- docs/maintenance.md:1035-1036 — two bullets of ~400-500 words each covering the edit-details dialog and add-to-gallery end to end; each mixes UI behaviour, API contract and privacy rationale.
- docs/maintenance.md:1175-1176 — the echo-rule and focus-management bullets each restate rationale three ways ("load-bearing", "do not collapse or reorder", the WCAG citation); ~600 words for two UI details.
- Repeated "do not X / never Y / is load-bearing" hedges inside single bullets (e.g. 1169's traversal bullet carries six separate prohibitions) make it hard to tell the rule from its history.

## Slice summary

Lines 1017-1282 are the tail of the Gallery feature bullets plus four security sections (uploaded file names, served bytes, stored media URL/host trust, storage-path confinement) and the start of Database Compatibility Guidelines. The content is durable reference, but roughly a third of its volume is PR-numbered history and review-round narrative that could move to commit messages; the two mediaId-integer statements (1018 / 1259) and the duplicated threatened-species rule (1026 / 1151) are the only confirmed content duplication. No stale file or symbol references survive checking apart from the deleted `backfillMediaBlurhash.ts` narrative.

## docs/maintenance.md lines 1283-1721

Sections in slice: tail of `### Review: Uploaded file names` (1283-1315), `### Review: Unique constraints (TOCTOU)` (1316-1330), `### Review: Database & migrations` (1331-1529), `### Review: Stored media` (1530-1710), head of `### Review: Served domains (Admin › Served domains)` (1711-1721, continues past slice end).

### Duplicates
- docs/maintenance.md:1354-1364 ≈ docs/mastodon-api-compatibility.md:1711 — the whole `getViewerFollow` rule (read paths only, `cache()`-wrapped, positional args because "cache keys on argument identity ... memoizes nothing", mutating routes excluded) restated near-verbatim in both files.
- docs/maintenance.md:1292-1296 ≈ docs/maintenance.md:1129 — `createMediaTempFilePath` temp-path rule (random prefix, `path.join` resolves `..`, prefix-cancellation) stated twice in the same file.
- docs/maintenance.md:1299-1311 ≈ docs/maintenance.md:1131 — ffmpeg video-preview rule (demuxer from path, `image2` beats content probing for `%0Nd`/`*` patterns, validate container from probe first) stated twice.
- docs/maintenance.md:1593-1610 ≈ docs/maintenance.md:1169 — traversal check after decoding (`..%2f`, host-relative `../../`, Win32 trailing-dots rule, "only a segment that RESOLVES to `..`") near-verbatim in both.
- docs/maintenance.md:1611-1626 ≈ docs/maintenance.md:1170 — "the driver will reject it" / `copyProfileImage` containment / `LocalFileStorage.getFile` vs `S3FileStorage` `medias/` prefix + CDN redirect URL, near-verbatim in both.
- docs/maintenance.md:1632-1651 ≈ docs/maintenance.md:1171-1172 — wildcard `ACTIVITIES_TRUSTED_HOSTS` rule (`new URL()` accepts `*`, `%2a`/IDNA decode makes the `*`, the consumer list, `normalizeHost` refusal) near-verbatim in both; the maintenance.md copy also duplicates the consumer list.

### Stale
- none — checked: `ls` on lib/services/medias/fileName.ts, lib/services/getViewerFollow.ts, lib/database/kysely/visibility/localActor.ts, lib/services/medias/storagePath.ts, lib/services/medias/storedImagePipeline.ts, scripts/maintenance/cleanupMediaStorage.ts, migrations/index.ts, migrations/names.ts, lib/database/testing/schemaInvariants.test.ts, lint/agentsRules.mjs → all exist; `grep -rln` on claimIdempotencyKeyPublish, deleteExpiredIdempotencyKeys, IDEMPOTENCY_PENDING_STALE_MS, discardUnpublishedStatus, createStoredImagePipeline, createStoredMaskPipeline, normalizeBlurhash, isTraversingStoragePath, getServedHostConfig, ensureServedDomainsFresh, getServedDomainWithPolicies, invalidateDomainIdentityCache, getServerIdentityView, resolveSignUpDomain, filterActorDomainsForAccount, isEmailAllowedForAccount, extractVideoPreviewFrame, getStoredMediaExtension, isOwnInstanceHost → all found in lib/; migration IDs `20260207223000_fix_attachments_media_id_type` / `20261012100000_attachments_media_id_integer_sqlite` found in lib/database/migrate/legacyKnexMigrations.ts (legacy list, not files — arguably intentional); `grep '"migrate:*"' package.json` → migrate:down/make/status/unlock exist.

### History / changelog text
- docs/maintenance.md:1310-1311 — "`IMG_%04d.jpg` on a valid mp4 turned a storable upload into a 500"
- docs/maintenance.md:1365-1367 — "it did for 216 of 221 rows on production"
- docs/maintenance.md:1427-1429 — "in v1.192.34's `migrations/`, is the pattern"
- docs/maintenance.md:1435-1436 — "(`attachmentsMediaIdIntegerMigration.test.ts`, in v1.192.34)"
- docs/maintenance.md:1453-1456 — timeline query-planning numbers ("176 buffers vs ~16,700 at a page of 30") — measurement anecdote
- docs/maintenance.md:1563-1566 — "`readValidThumbnail` gated on `stats()` and passed truncated PNGs under concurrent load"
- docs/maintenance.md:1572-1575 — "an uploaded `thumbnail` was stored by one and dropped by the other"
- docs/maintenance.md:1606-1610 — "this was a live arbitrary-file read, not a hardening exercise"
- docs/maintenance.md:1642-1645 — "`isOwnAuthority` in the blurhash backfill, was deleted by #1570"
- Also 1503-1520 — crash-caveat narration of a past failure sequence ("a process that dies after the key claim...") mixed into the idempotency bullet.

### Long sections
- docs/maintenance.md:1331-1529 `### Review: Database & migrations` (199 lines) — reference rules, not tables, but could be split into ~4 subsections (schema dumps/migrations, follow/local-actor reads, index design/query planning, media-id coercion); not pure reference tables.
- docs/maintenance.md:1530-1710 `### Review: Stored media` (181 lines) — could split into pipelines/EXIF vs driver parity vs URL/traversal security.

### Task/PR-specific
- docs/maintenance.md:1642-1645 — PR number #1570 as the provenance of a code change.
- docs/maintenance.md:1427-1436 — release version pin "v1.192.34" used twice to locate a migration and its test.

### Readability
- docs/maintenance.md:1457-1526 — a single ~70-line bullet (idempotency-key state machine: `onConflict`, states, `claimIdempotencyKeyPublish`, QStash/Cloud Tasks/NoQueue differences, crash caveats, TTL) — the worst wall of text in the slice; needs its own subsection or a state diagram/table.
- Nearly every bullet carries multiple bolded "never/always" rules plus 2-3-deep nested parentheticals (e.g. 1333-1352, 1663-1666, 1691-1700); the same sentence often states a rule, its historical bug, and its residual caveat at once.
- docs/maintenance.md:1395-1405 — index-ordering rule mixes a concrete example, a test reference and a planner explanation in one 20-line bullet.

### Slice summary
Durable reviewer rules for media upload/storage, database/migrations, and served domains. No stale references found; the main problems are (1) ~6 near-verbatim duplications of rules already stated at docs/maintenance.md:1129-1173 (and one with mastodon-api-compatibility.md), (2) two 180-200-line sections with several multi-decade bullets, the worst being a ~70-line single bullet, and (3) scattered PR/version/production-number history. Roughly a third of the duplicated rule text could go; the long sections need splitting rather than deletion.

