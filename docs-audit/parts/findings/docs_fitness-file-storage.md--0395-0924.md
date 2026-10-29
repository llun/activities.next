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
