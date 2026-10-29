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
