# docs/environment-variables.md lines 268-538

## Duplicates

- docs/environment-variables.md:272 ≈ docs/maintenance.md:1025 — the "suggestions are never decisions / owner-only candidates, saved only on owner confirmation" rule is stated in both the `ACTIVITIES_GALLERY_SUBJECTS` bullet and the maintenance guide's subject-suggestions section.
- docs/environment-variables.md:333 ≈ docs/maintenance.md:1123 — the blank-`ACTIVITIES_MEDIA_STORAGE_PATH` upgrade note (boot warnings, loose `<16 hex><ext>` files, move `./uploads/fitness/`) and the self-hosting/CSP instructions for `ACTIVITIES_PHOTO_MASK_MODEL_BASE_URL` (290/294) are both expanded again in docs/maintenance.md.
- docs/environment-variables.md:396 ("run **Regenerate maps for old statuses**") ≈ docs/fitness-file-storage.md:45 and docs/features.md:100 — the same regenerate-maps instruction with the same `POST /api/v1/fitness/general/regenerate-maps` route appears in three docs.

## Stale

None. Every file, symbol, and route named in the slice was checked and exists:
`lib/config/photoEditor.ts`, `lib/utils/host.ts` (`createServedDomainMatcher`),
`lib/services/domains/localDomains.ts` (`isLocalDomain`, `getLocalDomainMatcher`),
`lib/services/actors/resolveAccountTarget.ts`, `lib/services/quotes/*`,
`lib/activities/confirmActorHandle.ts`, `scripts/backup/productionArchive.ts`,
`scripts/backup/exportActorArchive.ts`, `/api/v1/web-vitals`,
`/api/v1/fitness/general/regenerate-maps`, `/fitness/privacy`. All 48
`ACTIVITIES_*` variables in the slice resolve to code in lib/app/scripts
including `OTEL_SERVICE_NAME`/`NEXT_TELEMETRY_DISABLED` (standard SDK vars the
doc correctly says the app does not read itself).

## History / changelog

- docs/environment-variables.md:490 — "until a planned database-backed domain
  list replaces `allowActorDomains`" — roadmap narrative about a future
  migration, not a durable reference fact (483-491).
- docs/environment-variables.md:333 — one-time upgrade walkthrough for the
  blank-path regression (boot warnings, where loose files landed, the old
  `uploads` fallback). Migration instructions, not reference material.
- docs/environment-variables.md:331 — "> Upgrade note:" telling operators to
  move `*_STORAGE_HOSTNAME` endpoint values to `*_STORAGE_ENDPOINT` — a past
  renaming's migration text.

## Task / PR-specific

- docs/environment-variables.md:333 — ~13-line single-paragraph upgrade note
  written for one past release (see History above); belongs in a migration
  guide or release notes, not the env-var reference.
- docs/environment-variables.md:304-312 — credential-exposure incident
  write-up ("treat it as a credential exposure", the full leakable-file list).
  Explains a fixed historical bug; the current rule ("blank required values
  disable storage with a warning") is already stated at 302 and 314.

## Readability

- docs/environment-variables.md:275 — 6-line bullet cramming throttle rates,
  circuit-breaker behaviour, and the `gallery_lookup_cache` caveat into one
  sentence chain.
- docs/environment-variables.md:302-316 — media/fitness blank-value rules are
  spread over three dense paragraphs plus two table cells plus two blockquote
  upgrade notes; the same "set-but-empty disables storage with a warning" rule
  is restated in each.
- docs/environment-variables.md:446-449 — Domain Controls table rows
  (`ACTIVITIES_ALLOW_ACTOR_DOMAINS`, `ACTIVITIES_TRUSTED_HOSTS`) are
  paragraph-length cells with nested cross-references; the "which domains are
  local" subsection (451-494, 44 lines) repeats much of it in prose.

## Long sections

- docs/environment-variables.md:335-353 — Fitness File Storage: 19 table rows,
  mostly necessary reference; the per-row prose could move to the guide.
- docs/environment-variables.md:440-449 — Domain Controls: 7 rows but several
  are 100+ word paragraphs; prose belongs in the linked subsection.
- No ## / ### section exceeds 80 lines.

## Slice summary

Reference-quality env-var tables (Gallery lookups, Photo editor, Media/fitness
storage, Queue, Push, Domain controls, Request config, Observability, Build)
with heavy paragraph prose interleaved. No stale identifiers found. The main
wins are removing the two one-time upgrade blockquotes (331, 333) and the
roadmap clause at 490, and de-duplicating the storage-fallback and
subject-suggestions rules against docs/maintenance.md and
docs/fitness-file-storage.md.
