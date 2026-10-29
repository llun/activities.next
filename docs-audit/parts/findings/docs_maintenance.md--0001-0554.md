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
