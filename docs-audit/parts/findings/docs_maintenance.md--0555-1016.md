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
