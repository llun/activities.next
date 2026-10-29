## docs/fitness-file-storage.md lines 1-394

Slice covers the title/Overview, Wahoo cloud imports, Configuration, Storage
Implementations, Database Schema, Pre-parsed route data cache, Route heatmap
tile pyramid, The static share image, The link-preview card, Gear Tracking,
API Endpoints, and Processing Pipeline through line 394 ("Several recordings of
one activity" begins at 379; its body continues past the slice end).

### Duplicates
- docs/fitness-file-storage.md:138 ≈ docs/fitness-file-storage.md:832 — the two-share-route query-parser drift explanation ("resolving `?z=4&z=16` differently; `Object.fromEntries` takes the last value, `searchParams.get` the first").
- docs/fitness-file-storage.md:168 ≈ docs/fitness-file-storage.md:734 — the partial-outage sweep measurement ("66 of 224 tiles untouched... lost 37% of the points") told twice.
- docs/fitness-file-storage.md:286 ≈ docs/fitness-file-storage.md:997 — the plain-vs-partial unique-index rationale ("chosen while MySQL-compatible clients... were still supported").
- docs/fitness-file-storage.md:75-76 ≈ docs/fitness-file-storage.md:368-369 — `mapError`/`mapImageEmailPath` semantics: the Database Schema column bullets and Processing Pipeline steps 4-5 restate the same map-failure/retry/keep-old-map behavior.
- docs/fitness-file-storage.md:90,100 ≈ docs/fitness-file-storage.md:309 ≈ docs/fitness-file-storage.md:366 — the `fitness_file_route_data` cache-first read path (cache hit → resolve in memory; miss → download, parse, backfill via `savePreParsedRouteData`) described three times, with a fourth summary at :9.
- docs/fitness-file-storage.md:33-37 ≈ docs/environment-variables.md:354-355 — provider selection and fallback semantics for `ACTIVITIES_FITNESS_MAP_PROVIDER`/`_MAPBOX_ACCESS_TOKEN`/`_APPLE_MAPS_*` duplicated in the env-var reference (which :47 already points to as the full provider reference).
- docs/fitness-file-storage.md:45 ≈ docs/fitness-file-storage.md:544,562 — the "Regenerate maps for old statuses" action described here and again in the later sections outside this slice.

### Stale
- none — checked every script, symbol, env var, migration name and endpoint cited in the slice against the repo:
  - `git ls-files | grep -E 'fitnessImportIsolation|fileRouteCache|cleanupMediaStorage|productionArchive|backfillFitnessMovingTime|normalizeFitnessActivityTypes|backfillFitnessRouteData|backfillFitnessDevices|repairStravaActivityFiles|heatmapEmbedImageUrl'` → all present.
  - All ~40 cited symbols (`loadPreParsedRouteData`, `savePreParsedRouteData`, `PRE_PARSED_ROUTE_DATA_VERSION`, `MAX_TILES_PER_VIEW`, `getRegionBounds`, `serializeRegions`, `NulFreeString`, `TrimmedOptionalActivityTypeParam`, `ACTIVITIES_ALT_TEXT`, `posts.maxCharacters`, etc.) → looped `git grep -lF` over lib/app/scripts; all found.
  - All cited migration timestamps (`20260211210400_add_fitness_files_table`, `20260817000000_add_fitness_route_heatmap_tiles`, `20260811000000_add_fitness_gear`, `20260813000000_add_fitness_device_gear`, `20260826120000_add_fitness_gear_component_periods`, `20261015000000_add_fitness_file_route_data`) → present in `lib/database/migrate/legacyKnexMigrations.ts` / `migrations/`.
  - All cited routes (`/api/v1/fitness-files*`, `/api/v1/fitness/gear*`, `/api/v1/fitness/strava*`, `/api/v1/fitness/import*`, `/api/v1/webhooks/strava/:webhookToken`, `/api/v1/accounts/:id/fitness-route-heatmap*`, `/embed/heatmap/[token]/*`, `/u/heatmaps/:token`, `/fitness/privacy`) → route files exist.
- Note: the six named gear/heatmap migrations exist only as legacy Knex migration records, not as files under `migrations/`; the doc's "was created by the ... migration" phrasing is still accurate for them, so not counted stale.

### History / changelog text
- docs/fitness-file-storage.md:126 — "Two unit conversions matter and both were wrong first".
- docs/fitness-file-storage.md:144 — "which the review of this change is what established"; also "That asymmetry got sharper when the refusal moved onto the pages" — review-of-a-change narrative inside the fail-closed spec paragraph.
- docs/fitness-file-storage.md:160 — "over tiles it no longer described, and rebuilt nothing" — past-bug narration.
- docs/fitness-file-storage.md:166 — "a failure between them used to leave the row stamped `generating`" — old-bug narration.
- docs/fitness-file-storage.md:168 — "Withholding the sweep was tried first and does not protect the missing geometry" — past-experiment narrative with one-off measurements.
- docs/fitness-file-storage.md:286 — "it was chosen while MySQL-compatible clients... were still supported" — decision history for the index choice.
- docs/fitness-file-storage.md:298 — "Importing those values used to mint a local gear per Strava id or name, with a `kind` guessed..." — how a past bug was fixed.

### Long sections
- docs/fitness-file-storage.md:102-171 `### Route heatmap tile pyramid` (70 lines) — under the 80-line threshold but one unbroken wall of dense prose; could be split per table/rule, content itself is reference.

### Task/PR-specific
- docs/fitness-file-storage.md:172-218 `#### The static share image` — mostly durable reference, but large parts argue the choices of one change (format=png opt-in, `?w=1200&h=600` snapping, why the card subtitle was rejected).
- docs/fitness-file-storage.md:219-265 `##### The link-preview card` — narrative of one feature addition (adding `format=png`, card subtitle formatting decision, noindex rationale) rather than durable reference.
- docs/fitness-file-storage.md:379-394 `### Several recordings of one activity` (start; body continues past slice) — UI micro-detail: focus management, live-region/Alert behavior, screen-reader announcement ordering, retry-button focus — change-write-up detail, not storage reference.

### Readability
- docs/fitness-file-storage.md:7 — the Overview body is a single ~450-word paragraph mixing the move/isolation state machine with edge-case enumeration; hard to scan.
- docs/fitness-file-storage.md:144 — one ~380-word paragraph mixing fail-closed spec, history and threat model.
- docs/fitness-file-storage.md:309 — the `/route-data` endpoint bullet is a ~200-word single bullet nesting response shape, sample semantics and cache behavior.
- docs/fitness-file-storage.md:383 — the "When a post created by `importFitnessFiles` is stamped depends on why the import ran" paragraph is a ~300-word backdating/visibility rationale inside a numbered pipeline.
- Repeated emphatic rule restatements ("None of this bypasses the fence", "None of that governs…", bolded doctrine sentences) occur throughout 102-171, adding to the density.

### Slice summary
Durable reference doc (env vars, schema, endpoints, pipeline) buried under heavy
narrative. Roughly a third of the slice (Overview paragraph, tile-pyramid
sections, link-preview card, recordings UI detail) is rationale/change-write-up
that could move to a design-notes file or be cut; the confirmed duplicate
narratives (:138/:832, :168/:734, :286/:997, cache read path x3, provider env
block vs environment-variables.md) are the easiest removals. No stale
references found — every name checked still exists.
