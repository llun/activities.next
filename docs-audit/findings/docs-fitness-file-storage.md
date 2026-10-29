# Findings: docs/fitness-file-storage.md

Generated slice by slice by GLM-5.3-flash from origin/main aa368a596 (brief: ../findings-brief.md).

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

## docs/fitness-file-storage.md lines 395-924

Slice: end of "User-Facing Features" (activity page), "Maintenance Scripts", "Security and Privacy", and the first four "Contributor rules" sections (Stat Strips, Apple Maps Basemap, Activity Dates, Route Heatmap Pyramid).

### Duplicates
- docs/fitness-file-storage.md:466 ≈ docs/architecture.md:1141, docs/maintenance.md:984, docs/mastodon-api-compatibility.md:1098, docs/setup.md:365 — verbatim "Contributor rules" boilerplate: "Read the applicable rules and review checks below before changing this subsystem. The mandatory workflow remains in [AGENTS.md]…". Same sentence in five docs files.
- docs/fitness-file-storage.md:444 ≈ docs/maintenance.md:653 — "`.env.local` shadows `.env.production` even under `NODE_ENV=production`" recovery-script warning, stated in both files.
- docs/fitness-file-storage.md:799-810 ≈ docs/fitness-file-storage.md:138 — the same rationale stated twice in this file: `getFitnessRouteHeatmapSummaryByShareToken` reads the share row without its geometry, and the two tile routes share one query parser because "they had already drifted" over `?z=4&z=16` and a malformed `v`. Lines 138 and 831-835 are near-verbatim; 799-806 repeats 138's first sentence.
- docs/fitness-file-storage.md:536 ≈ docs/fitness-file-storage.md:546 — "Regenerate maps for old statuses" (`/fitness/privacy`, `POST /api/v1/fitness/general/regenerate-maps`) introduced twice within the Apple Maps Basemap section (minor, same section).

### Stale
- none — checked all 17 `scripts/fitness/*.ts` names from the Maintenance Scripts list (`ls scripts/fitness/<name>.ts`, all exist); checked symbols `estimateRecordingSeconds`, `buildChartTimeAxis`, `detectClimbs`, `resolveStravaDefaultVisibility`, `getMediaReservedFitnessPathPrefixes`, `flattenPrivacySegmentsForPublic`, `flattenTilePrivacyForPublic`, `parseTileBatchQuery`, `heatColorForCount`, `buildHeatmapEmbedImageUrl`, `loadSharedHeatmap`, `getFitnessRouteHeatmapSummaryByShareToken`, `resolveSharedHeatmapRegionBounds`, `isSerializableRect`, `mutedStandardMapType`, `countableActivitiesInWindow`, `MAX_SNAPSHOT_OVERLAYS`, `MAPBOX_STATIC_URL_BUDGET`, `requireAllOverlays`, `MAX_TILES_PER_VIEW`, `buildHeatmapSegmentsFromTiles`, `postAtImportTime`, `getActivityImportGroupKey`, `mergeTileDelta`, `parseOpenGraph`, `useHasHydrated`, `localDayWindow`, `bucketByLocalDay`, `getRegionBounds`, `serializeRegions`, `buildHeatmapTileSource`, `splitSegmentByBounds`, `decodeTile`, `isPyramidVariant`, `DIMENSION_STEP`, `StatStrip`, `HEAT_COUNT_COLOR_STOPS`, `countFitnessFilesByActor`, `StatusFitnessFile` (`git grep -ln`, all found); checked paths `lib/services/strava/defaultVisibility.ts`, `lib/fitness/calendar/localDay.ts`, `lib/services/fitness-files/appleMapsSnapshot.ts`, `lib/services/fitness-files/heatmapTiles/constants.ts`, `app/(timeline)/[actor]/[status]/ActivityStartTime.tsx`, `docs/maintenance.md`, `app/api/v1/fitness-files/`, `app/api/v1/fitness/general/regenerate-maps/` (all exist); checked env vars `ACTIVITIES_FITNESS_STORAGE_TYPE`, `ACTIVITIES_FITNESS_STORAGE_PREFIX`, `ACTIVITIES_MEDIA_STORAGE_PATH` (all read in `lib/config/`).

### History / changelog text
- 454 — "Before this was shared, the webhook route parsed and the job did not"
- 457 — "It used to answer any request whenever the attached status was public or unlisted"; also "since replaced by the picker's download button" and "The activity detail no longer has a footer file row" — a past-behavior narrative inside a still-valid owner-only rule.
- 435 — "for activities imported before gear tracking existed" — why-the-script-exists framing; the script description itself is durable.
- 576-592 — "used to be equal" / "silently started dating rides wrongly" — a past-bug story woven through the Activity Dates rule (the durable rule — read `activityStartTime` — survives without it).
- 616 — "that is how the calendar used to bucket by UTC date"
- 660-661 — "a routine region-row retry took a healthy completed pyramid to a failed, empty one"
- 693 — "a per-guard release was missed on one of them twice"
- 734 — "a partial outage kept 66 of 224 tiles and still lost 37% of the points" — a one-off measurement from a past incident.
- 757-761 — "which is exactly how the gate came to be on the pages and missing on the route"
- 782 — "`serializeRegions` used to emit a rectangle that rounding had collapsed, and rows written then still hold one"
- 831-835 — "Two parsers had already drifted" (duplicated with line 138, see above)
- 877-878 — "which dropped those instances to the keyless SVG and cost them their basemap"

### Long sections
- docs/fitness-file-storage.md:623-924 "Fitness Route Heatmap Pyramid" (302 lines) — far over the 80-line limit; bullets run 10-20 lines each. Could be split into sub-sections (build/resume protocol, serving/clipping, static image, client behaviour); the content itself is durable reference, not tables.
- docs/fitness-file-storage.md:404-420 "The activity page" (17 lines) — under the limit but two bullets (lines 410, 411) are single ~1,400-character paragraphs; could be split into per-part bullets.

### Task/PR-specific
- 441-443, 452-463 — one-time backfill/migration scripts documented at paragraph length: `backfillFitnessMovingTime` (recomputes `movingTimeSeconds` for "already-stored files"), `backfillFitnessRouteData`, `backfillFitnessDevices`, `normalizeFitnessActivityTypes` ("only for older history"), `importFitnessGear`/`convertStravaExportToGearImport` (historical Strava gear reconstruction). Each is a migration that has presumably been run; candidates to condense or move to docs/maintenance.md once done.
- 457 — the three former linking surfaces and the removal narrative are release-notes material; the current owner-only rule is the durable part.

### Readability
- 623-924 — the pyramid section's bullets are 10-20 lines of nested parentheticals with inline ALL-CAPS emphasis (POSITIONAL, CARRYING, DELETES); several rules cite a past failure as their only justification, which buries the rule itself.
- 419 — `fitnessActivityMetrics.ts`, `activityAnalysis.ts`, `fitnessChartData.ts` are named bare with no path; they actually live in `app/(timeline)/[actor]/[status]/`, not under `lib/services/` where most other paths in this file point.
- 566-622 — Fitness Activity Dates is one 57-line section where the timezone rule, the backdating rule and the "don't derive one from the other" rule are three separate concerns in one bullet stream.

### Slice summary
Lines 395-463 are the feature/script/security reference (accurate, nothing stale, all scripts and symbols verified present). Lines 464-924 are "Contributor rules": four durable rule sections, of which the Route Heatmap Pyramid (302 lines) dominates and is the main splitting/shortening candidate. Roughly 12 passages are past-PR/past-bug narratives that could be cut without losing any rule; one boilerplate sentence and the `.env.local` warning are duplicated across five and two docs files respectively.

## docs/fitness-file-storage.md lines 925-1470

Slice covers the entire `### Fitness Gear` section (925-1470) of the "Contributor rules" part: derived gear totals, component install periods, gear/component table rendering, product links, activity gear assignment, Strava import policy, and device gears.

### Duplicates
- docs/fitness-file-storage.md:1098-1101 ≈ docs/fitness-file-storage.md:299 — "evaluate service reminders only after the activity is `completed`" / "reads the total from before the activity that caused the crossing" stated in both Gear Tracking and Fitness Gear.
- docs/fitness-file-storage.md:1228-1231 ≈ docs/fitness-file-storage.md:299 — "no recurring job infrastructure; the queue can delay a message but not repeat one" repeated verbatim in intent.
- docs/fitness-file-storage.md:1197-1206 ≈ docs/fitness-file-storage.md:298 — "neither the webhook path nor the archive path reads gear from Strava... no import ever creates a gear row" vs "**Strava's own gear is deliberately ignored**" — near-verbatim, including the `kind`-guess rationale.
- docs/fitness-file-storage.md:1205 ≈ docs/architecture.md:3172-3173 — "No importer reads gear from Strava or creates a gear row" third statement of the same rule.
- docs/fitness-file-storage.md:927-933 ≈ docs/architecture.md:3168-3170 — "derived, never stored" gear distance plus the shared stats-predicate rule.
- docs/fitness-file-storage.md:1076-1080 ≈ docs/architecture.md:3170-3171 ≈ docs/maintenance.md:697 — sport matching through `normalizeActivityTypeToSportKey`, never the raw `activityType`.
- docs/fitness-file-storage.md:1232-1243 ≈ docs/fitness-file-storage.md:1362-1364 ≈ docs/architecture.md:3327-3331 — orange text uses `text-primary-text`, `text-primary` is 3.37:1 / below AA; stated three times (architecture.md:1390 even cross-references back to this section, then architecture.md:3327 restates it).
- docs/fitness-file-storage.md:1329-1334 ≈ docs/architecture.md:1387 — `SectionNavSelect` "state-driven twin of `SectionNavDropdown`", boolean `aria-current` "because nothing is a page" — near-identical explanation.
- docs/fitness-file-storage.md:1344-1368 ≈ docs/fitness-file-storage.md:276 — product page rule: `GearProductLink` hostname-only, `getProductUrlHostname` http(s) guard against `javascript:` hrefs, `resolveDeviceGear` brand-map seeding — duplicated within the file (~70 lines apart).
- docs/fitness-file-storage.md:1416-1422 ≈ docs/fitness-file-storage.md:293 — "`resolveDeviceGear` is the only thing that creates a device" + `POST /api/v1/fitness/gear` rejects `device` with 422, duplicated within the file.
- docs/fitness-file-storage.md:1026-1031 ≈ docs/fitness-file-storage.md:1378 — the gear-list "known gap" (tables pin but do not snap, `min-w-[560px]`) described twice.

### Stale
- none — all referenced symbols verified to exist: `useGearTableColumns.ts`, `gearUi.ts`, `scripts/fitness/normalizeFitnessActivityTypes.ts`, `activityPresentation.ts`, `sportTypes.ts` (`SPORT_KIND`, `getSportKeysForKind`), `fitnessDeviceBrands.ts` (`getDeviceLinkTarget`), `lib/database/kysely/dialect.ts`, `lib/database/domains/fitnessGear/queries.ts`, `GearListView.tsx` (`min-w-[560px]` at GearListView.tsx:155), `GearActivitiesFeed.tsx`, `section-nav-select.tsx`, `GearProductLink.tsx`, `globals.contrast.test.ts`, `processFitnessFileJob.test.ts`, `fitnessGearComponentPeriods.test.ts`, plus `evaluateGearServiceReminders`, `diffGearComponents`, `isUniqueConstraintError`, `normalizeStoredActivityType`, `lastAlertedDistanceMeters`, `assignFitnessFileGearIfUnset`, `setFitnessFileGear`, `findFitnessGearByDefaultSport` (checked via `git ls-files | grep` and `git grep -nE` over app/lib/scripts). `docs/architecture.md` orange-text exceptions reference also resolves.

### History / changelog text
- 943-948 — "clearing `removedAt` reopened the ORIGINAL window, so a part unretired months later was credited every activity"
- 964-975 — "lets `[May 1, Feb 15)` through — a period no activity can fall inside... The bug reads as correct because"
- 1030-1031 — "the same failure `min-w-[720px]` used to cause on the components table"
- 1072-1075 — "\"Refit\" beside \"Confirm delete\" measured 152px against the 124px"
- 1129-1134 — "rows imported before this rule keep whichever one they came in with"
- 1141-1142 — "exactly what captioned a `MountainBikeRide` with the road-bike glyph"
- 1154-1157 — "made a directly uploaded handcycle ride disagree with the same ride imported from Strava"
- 1205-1208 — "the `stravaGearId` column is gone with them... it was guessed from an undocumented `b`/`g` id prefix"
- 1254-1256 — "the rows read as loose text, which is what these tables looked like before"
- 1264-1266 — "came out a bright stripe in light mode... and a sunk well in dark"
- 1281-1292 — "\"Handlebar\" (72.6px...) broke mid-word" and "\"Continental\"... wrapped its trailing 'l'" — pixel-measurement anecdotes
- 1309-1311 — "a 390px phone grew to ~1,770px wide on a gear's page"
- 1354-1355 — "It was device-only and the API 422'd it for anything else; that restriction is gone"
- 1357-1359 — "a row written before the API validated the column" (legacy-data aside; also at :276)

### Long sections
- 925-1470 `### Fitness Gear` (546 lines) — a single bullet list, most bullets 15-50 lines; should be split into sub-headings (derived totals & periods / table rendering / product links / assignment & Strava / devices). Not reference tables — prose.

### Task/PR-specific
- none — the rules are durable, though the past-bug anecdotes listed above are the PR write-up residue inside them.

### Readability
- Several bullets run 20-50 lines as one sentence with nested bolded sub-rules and em-dash chains (984-998, 1246-1300); the table bullet even contains display math (`$W_{\text{avail}}$`, `$N_{\text{fit}}$`) inside prose.
- High interdict density — "Do not reintroduce", "Do not put ... back", "Do not write a third copy", multiple "never"s per bullet — often restating the same prohibition in both positive and negative form.

### Slice summary
The slice is the whole 546-line `### Fitness Gear` contributor-rules section. It is dense durable guidance, but roughly a third of it is past-bug/past-measurement narrative that belongs in history, and most of its storage/import rules are stated a second (or third) time in the file's own "Gear Tracking" section (266-300), docs/architecture.md (~3168-3173, ~1387, ~3327) and docs/maintenance.md:697. Splitting the section and replacing the duplicated statements with cross-references would remove the bulk of its length.

## docs/fitness-file-storage.md lines 1471-1557

Slice = the tail of the file (file is 1556 lines long): `### Review: Apple Maps basemap` (1471-1489, with an anchor at 1489) and `### Review: Fitness route heatmap pyramid` (1491-1556), both living under `## Contributor rules` (starts at 464). These two "Review:" subsections are condensed rewrites of the durable Contributor-rules sections earlier in the same file.

### Duplicates
- docs/fitness-file-storage.md:1473-1475 ≈ docs/fitness-file-storage.md:520-525 — "Every Apple-rendered map draws `mutedStandard`" / `mapType: mutedStandardMapType(mapkit)` to `new mapkit.Map(...)` and `t=mutedStandard` stated twice (durable section "Apple Maps Basemap" at 518 vs this Review section).
- docs/fitness-file-storage.md:1478-1481 ≈ docs/fitness-file-storage.md:532-535 — "mutedStandardMapType falls back to the literal" rule duplicated (grep `mutedStandardMapType` hits both).
- docs/fitness-file-storage.md:1518-1520 ≈ docs/fitness-file-storage.md:~750-760 — fold-once / positional `(createdAt, id)` cursor rule restated in Review form; same claim-token rules appear in the 623-924 section.
- docs/fitness-file-storage.md:1521-1523 ≈ docs/fitness-file-storage.md:758 — `buildHeatmapTileSource` public-route gate "rather than re-deriving the conditions" duplicated nearly verbatim.
- docs/fitness-file-storage.md:1531-1533 ≈ docs/fitness-file-storage.md:784 — the one `resolveSharedHeatmapRegionBounds` gate for all four PUBLIC surfaces duplicated.
- docs/fitness-file-storage.md:1534-1536 ≈ docs/fitness-file-storage.md:790 — `isSerializableRect` / thinner-than-0.01° box takes the WORLD's key duplicated.
- docs/fitness-file-storage.md:1540-1541 ≈ docs/fitness-file-storage.md:808 — `flattenTilePrivacyForPublic` "beside the untiled doctrine" + re-encode every byte duplicated.
- docs/fitness-file-storage.md:1545-1547 ≈ docs/fitness-file-storage.md:865 — static share image gates on `buildHeatmapTileSource` before reading, clips to shared row's region duplicated.
- docs/fitness-file-storage.md:1551-1553 ≈ docs/fitness-file-storage.md:883 (also 43, 878) — Apple refuses past `MAX_SNAPSHOT_OVERLAYS`, Mapbox truncates, tiled candidate passes `requireAllOverlays` duplicated.
- docs/fitness-file-storage.md:1485-1487 ≈ docs/fitness-file-storage.md:43 — snapshot-URL query parameter shifts `MAX_SNAPSHOT_OVERLAYS`, re-check the ceiling duplicated (43 spells out the ~145-char-per-overlay math).
- docs/fitness-file-storage.md:1556 — "See AGENTS.md → Fitness Route Heatmap Pyramid" pointer is itself a cross-reference, not a duplicate; kept.

In effect the entire slice restates rules already stated in `### Apple Maps Basemap` (518-564) and `### Fitness Route Heatmap Pyramid` (623-924). If the durable sections stand, roughly all 86 lines of this slice could go.

### Stale
- none — checked every identifier in the slice against code: `mutedStandardMapType` (lib/components/fitness/ActivityRouteMapKit.tsx:31), `MAX_SNAPSHOT_OVERLAYS` and `buildPath` (lib/services/fitness-files/appleMapsSnapshot.ts:143), `buildHeatmapTileSource` (lib/services/fitness-files/heatmapTiles/tileSource.ts, imported at app/embed/heatmap/[token]/tiles/route.ts:8), `flattenTilePrivacyForPublic` (lib/services/fitness-files/publicHeatmap.ts:49), `resolveSharedHeatmapRegionBounds` (app/embed/heatmap/[token]/image/route.ts:12), `isSerializableRect`/`serializeRegions` (lib/fitness/regions.test.ts:330, app/(timeline)/fitness/heatmap/FitnessHeatmapView.tsx), `claimSeq` (app/api/v1/accounts/[id]/fitness-route-heatmap/route.test.ts), `requireAllOverlays` (lib/services/fitness-files/staticHeatmapImage.ts:125). The AGENTS.md pointer resolves: AGENTS.md:348 `## Fitness Route Heatmap Pyramid`.

### History / changelog text
- none in this slice (no PR numbers, dates, or "used to / was moved" narratives; the drift explanation lives at 136 and ~758, outside the slice).

### Long sections
- none — `### Review: Apple Maps basemap` is 18 lines, `### Review: Fitness route heatmap pyramid` is 66 lines (1491-1556), both under the 80-line threshold. (The durable `### Fitness Route Heatmap Pyramid` at 623-924 is ~300 lines but outside this slice.)

### Task/PR-specific
- none — but the two "Review:" headings themselves read as artifacts of a one-off review pass appended under "Contributor rules", which is the root cause of the duplication above.

### Readability
- Dense 4-6-line bullets with nested conditional caveats (1507-1512 recount/already-folded guard; 1524-1529 CARRYING vs CLAIM release paths; 1533-1538) — hard to scan; would benefit from splitting rule from rationale.
- Inconsistent ALL-CAPS emphasis mid-sentence (EXACTLY ONCE, PUBLIC, PRODUCES, CARRYING, CLAIM, BEFORE) used as inline stress rather than formatting.
- The anchor `<a id="review-fitness-route-heatmap-pyramid">` at 1489 targets a duplicate Review section rather than the durable 623 section.

### Slice summary
End of "Contributor rules": two condensed "Review:" subsections that restate the Apple Maps basemap and heatmap-pyramid rules already covered durably at 518-564 and 623-924. No stale references; nearly the whole slice (≈86 of 86 lines) is duplication and could be deleted once the durable sections are confirmed complete, keeping only the AGENTS.md pointer if the durable section lacks one.

