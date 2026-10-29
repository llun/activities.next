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
