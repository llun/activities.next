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
