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
