# Fitness File Storage and Processing

This document describes the current fitness file upload, processing, display, and import pipeline in Activity.next.

## Overview

Users can upload `.fit`, `.gpx`, and `.tcx` activity files. Fitness files use the same account-level storage quota as regular media and can be stored on the local filesystem, S3, or any supported S3-compatible object storage.

After a file is attached to a status, the background processor parses activity data, stores metrics on the `fitness_files` row, generates a route map when GPS data is available, and queues route heatmap cache jobs.

## Configuration

Fitness storage is configured in `lib/config/fitnessStorage.ts`.

- `ACTIVITIES_FITNESS_STORAGE_TYPE` - Storage type: `fs`, `s3`, or `object`
- `ACTIVITIES_FITNESS_STORAGE_PATH` - Local filesystem path
- `ACTIVITIES_FITNESS_STORAGE_BUCKET` - S3 bucket name
- `ACTIVITIES_FITNESS_STORAGE_REGION` - S3 region
- `ACTIVITIES_FITNESS_STORAGE_HOSTNAME` - Optional public hostname/CDN used to serve fitness files
- `ACTIVITIES_FITNESS_STORAGE_ENDPOINT` - Optional S3-compatible API endpoint for storage operations and presigned uploads
- `ACTIVITIES_FITNESS_STORAGE_PREFIX` - S3 key prefix, default `fitness/`
- `ACTIVITIES_FITNESS_STORAGE_MAX_FILE_SIZE` - Max file size, default 50 MiB
- `ACTIVITIES_FITNESS_STORAGE_QUOTA_PER_ACCOUNT` - Account quota override shared by media and fitness files
- `ACTIVITIES_FITNESS_MAP_PROVIDER` - Map provider for browser maps and static route images: `apple`, `mapbox`, or `osm`. Missing or invalid credentials for the selected provider fall back to keyless `osm` (MapLibre GL JS + OpenFreeMap tiles). When unset, a configured Mapbox token selects `mapbox`, otherwise `osm`.
- `ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN` - Mapbox token, required when the provider is `mapbox`
- `ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID`, `ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID`, `ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY` - Apple MapKit JS credentials, required when the provider is `apple`

With the `apple` provider, per-activity route-map images are rendered by Apple Web Snapshots. A heatmap embed image may or may not be: a heatmap draws one polyline overlay per segment, and each overlay costs ~145 characters of the ~5,000-character snapshot URL limit, so an input past `MAX_SNAPSHOT_OVERLAYS` is refused before simplification runs. The image path answers that by trying its next-coarsest source rather than giving up — tile geometry first, then the stored blob, which is roughly one polyline per activity — and only falls through to the built-in SVG heatmap renderer when neither fits.

See [environment-variables.md](./environment-variables.md) for the full provider reference.

If no fitness-specific storage is configured, the app falls back to the media storage backend with a separate local `fitness` directory or S3 `fitness/` prefix. The fallback needs a usable media storage configuration: if the `ACTIVITIES_MEDIA_STORAGE_*` variable it reads is set but blank, fitness storage is disabled too rather than defaulting to a directory under the application root.

Setting `ACTIVITIES_FITNESS_STORAGE_TYPE` to a non-empty value opts out of that fallback entirely. If it is set but the configuration is unusable — a blank `ACTIVITIES_FITNESS_STORAGE_PATH`/`_BUCKET`/`_REGION`, or an unrecognised type — fitness storage is disabled with a warning naming the variable, rather than silently falling back to the media backend. In that state `scripts/maintenance/cleanupMediaStorage.ts` refuses to run, because it cannot tell which stored objects belong to fitness and would report them all as orphaned media.

## Storage Implementations

- `LocalFileFitnessStorage` (`lib/services/fitness-files/localFile.ts`) stores files on disk.
- `S3FitnessStorage` (`lib/services/fitness-files/S3StorageFile.ts`) stores files in S3 or S3-compatible object storage.
- Both implementations enforce file type, file size, and combined media + fitness quota checks before saving.

## Database Schema

The `fitness_files` table is created by `migrations/20260211210400_add_fitness_files_table.js` and extended by later migrations for async processing, import tracking, activity metadata, and device info.

Important columns include:

- `id`, `actorId`, `statusId`
- `path`, `fileName`, `fileType`, `mimeType`, `bytes`
- `description`
- `processingStatus`
- `isPrimary`, `importBatchId`, `importStatus`, `importError`
- `totalDistanceMeters`, `totalDurationSeconds`, `elevationGainMeters`
- `movingTimeSeconds` — time (seconds) the athlete was actually moving, with stops excluded. Kept separate from `totalDurationSeconds` (elapsed time) so average pace/speed is computed over moving time, matching how Strava reports it. Nullable: records parsed before this column existed, or files with no per-point data to derive it, fall back to elapsed time (backfill with `scripts/fitness/backfillFitnessMovingTime.ts`).
- `activityType` — the sport, stored as a canonical **activity type** (`ride`, `gravel_ride`, `mountain_bike_ride`, `ebike_ride`, `virtual_ride`, `run`, `trail_run`, `walk`, `hike`, `swim`, `training`, `rowing`, `yoga`, `climbing`, `ski`, `skating`, `surfing`, `racket_sports`, `martial_arts`, `team_sports`, `golf`, `other`), not as the raw string the source file carried. Four vocabularies reach the parser — FIT `sport`/`sub_sport` (`cycling`, `gravel_cycling`), Garmin TCX `Sport` (`Biking`), Strava `sport_type` (`Ride`, `GravelRide`, written verbatim into the TCX built for an import) and free-form GPX `<trk><type>` text — so the same ride arrived spelled three ways and everything that GROUPS or FILTERS on the value counted it as three activities: the fitness overview breakdown, the calendar filter, and the per-type route-heatmap cache key. `toActivityData` in `activityData.ts` (`parseFitnessFile.ts`) is the single funnel every parser returns through, so normalizing there covers uploads and the Strava webhook alike. Any value that does not match a known sport key or canonical non-gear activity defaults to `other`. Nullable. History imported before this rule is swept by `scripts/fitness/normalizeFitnessActivityTypes.ts`.
- `activityStartTime`
- `hasMapData`, `mapImagePath`
- `mapError` — why the route map is missing, when one was expected. Deliberately separate from `processingStatus`/`importError`: those mean "this activity is not usable" and gate the status detail dashboard, the post's stat grid, the fitness overview, the profile's Fitness tab and every stats/heatmap rollup, so reusing them for a missing image would hide hundreds of good imports during a tile-server or storage outage. Nullable, and null is the norm — no GPS data, a privacy location leaving no exposed route, and a map that rendered fine all leave it null. Cleared on every successful (re)processing run. The post surfaces it to its **owner only**, and as a closed vocabulary rather than the reason — `fitness.mapFailure` is `missing` (none could be produced) or `stale` (the previous one is still shown, because the run that should have replaced it failed), so each surface's copy matches what the post actually shows. The status payload is readable by every viewer, while the reason is a raw error string that can name internal infrastructure, so it is rendered only on the owner's own fitness files page.
- `mapImageEmailPath` — path of a JPEG copy of the route map in `mapImagePath`, stored for the activity-import email only. Every image the media storages write is WebP, which Outlook desktop (Word rendering engine) and Windows Mail cannot decode, so those recipients saw the image's alt text instead of their route. The copy is not attached to the status and never federates. Nullable, and only written by an import that is going to email the owner — checked against `notifyOnComplete`, the instance having email configured, and the owner's activity-import email preference, so instances that send no email store no copies. An activity with no GPS data has no map at all, and activities imported before this column existed keep pointing their (already sent) email at the WebP. Because it has no `medias` row, the fitness file is its only reference: it is deleted wherever that reference is dropped — deleting the activity, deleting the post with `delete_media=true`, reprocessing or re-importing the file, **Regenerate maps** replacing or removing the map it was made from, and `scripts/fitness/repairStravaActivityFiles.ts --delete-missing` — `scripts/maintenance/cleanupMediaStorage.ts` treats it as referenced rather than orphaned, and `scripts/backup/productionArchive.ts` archives it with the other media. Its bytes are checked against the account quota before being written but are not added to the usage counters, which are maintained alongside `medias` rows. Deleting a post _without_ `delete_media` keeps the copy, which is the same thing that happens to the WebP the post displayed: the activity itself, and so the reference, survives.
- `deviceManufacturer`, `deviceName`
- `gearId` — the bike or pair of shoes this activity is attributed to, or null. See Gear Tracking below. Deliberately a plain indexed column with no database-level foreign key: adding one through `alterTable` needs a table rebuild on SQLite, so the relationship is enforced in `lib/database/sql/fitnessGear.ts` instead, and deleting gear nulls the column in the same transaction.
- `deviceGearId` — the `kind: 'device'` gear row for the head unit or watch that recorded this activity, or null. Resolved from `deviceName`/`deviceManufacturer` on import; those two stay the immutable recorded facts while the gear row carries the owner's editable name, brand, model and product page. Same plain-indexed-column-with-no-FK treatment as `gearId`, and deleting the device detaches it the same way.
- `createdAt`, `updatedAt`, `deletedAt`

Route heatmap caches are stored in `fitness_route_heatmaps`. They are keyed by actor, activity type, period, and region and store serialized route segments rather than generated PNG files. A nullable `shareToken` column backs the shareable/embeddable heatmap views (iframe + image). User-assigned names for heatmap regions are persisted separately in `fitness_route_heatmap_region_names` (keyed by actor and region) so they survive reloads.

### Route heatmap tile pyramid

Storing a whole heatmap as one blob of segments means fitting it to a single global vertex budget, and that is why the map's precision falls off as its coverage grows: a city-sized heatmap fits the budget at the 1 m simplification floor and looks sharp, while a world-spanning one is coarsened to hundreds of meters and cuts across roads. Zooming in never reveals more detail, because the geometry is simplified once and reused at every zoom.

Three tables (`migrations/20260817000000_add_fitness_route_heatmap_tiles.js`) hold the replacement, a per-actor zoom-tiled pyramid whose precision is fixed per screen pixel at every zoom rather than shared out across the whole map:

- `fitness_file_routes` caches each activity's simplified polyline, keyed by `fitnessFileId`, with the route's bounding box and a `sourceVersion` for invalidating the cached representation. Geometry otherwise exists only inside the original FIT/GPX/TCX in object storage, so without this every rebuild re-downloads and re-parses every file. An activity with no GPS gets a row with no points and null bounds — a negative cache, so rebuilds stop re-reading treadmill files to rediscover they have no route.
- `fitness_route_heatmap_pyramids` holds one build-state row per actor: a monotonic build `version`, the `(cursorCreatedAt, cursorId)` keyset resume position, and the progress counters. Build ownership is a compare-and-swap on a separate `claimSeq` that every claim bumps — including a resume, which by definition keeps its `version`, so guarding on the version instead would leave a resumed build with no fence at all. `updatedAt` doubles as the heartbeat that tells an abandoned build apart from a running one — except for a build's own continuation, which identifies itself by row and token and is exempt (see below). The token is necessary but **not sufficient**: a claim also re-asserts, at the moment of the write, every part of the state its decision was made on — `status`, `completedAt` and `updatedAt` for whether the build is takeable, and, when the claim RESOLVED to a resume rather than merely being offered one, the cursor columns it will carry on from. An incumbent moves all of those without ever touching the token, so guarding on the token alone would let a claim steal a build that heartbeated, discard one that finished, or resume one whose cursor had just been cleared and rescan from the beginning into its own tiles. The JS and SQL views of "has a cursor" are deliberately identical, both testing the two columns for null rather than for truthiness: a state one side calls resumable and the other does not is a row whose claim can never match, which wedges that actor's pyramid permanently. Every tile write is fenced on the same token, and that check doubles as a heartbeat, so flushing tiles is itself what proves a pass is alive.
- `fitness_route_heatmap_tiles` holds the geometry, one row per `(actorId, tileKey)` where the key is `"z:x:y"`, alongside the numeric `z`/`x`/`y` a viewport range-scans. Each row records the build `version` that wrote it, so a resumed pass adds to its own tiles, a fresh build replaces them, and sweeping older versions on completion is how activities deleted BETWEEN builds drop out — with no per-activity bookkeeping and no decrementing of visit counts. Not one deleted during the build it is part of: that activity's page was already fetched, so it is folded from the route cache and its tiles carry the current version, which the sweep cannot reach. The next build does not scan it and sweeps it then.

Both JSON payload columns use the same `mediumtext`-on-MySQL treatment as the route cache's, since a long ride and a dense city tile can each outgrow a 64 KiB `text`.

`fitness_file_routes` is live. Processing an uploaded or imported file caches its polyline as a side effect of the parse that already happened (`lib/services/fitness-files/fileRouteCache.ts`), and heatmap generation reads those routes in small batches, falling back to the source file only for activities with no usable row and writing through when it does. A history uploaded since the cache existed regenerates without touching object storage. The write is best-effort in both places and records no failure signal on the activity: a missing row is invisible, because the next generation simply parses the file as it always did.

The batch is deliberately much smaller than the page of activities being scanned. Each row is a decoded polyline held until its batch is done, and one row is capped at `filePointLimit` points, so reading a whole page ahead would put a page's worth of geometry live at once — past the job's own memory threshold, on histories that completed fine when it held a single parse at a time. The accumulation memory guard cannot recover from that (it downsamples the accumulated segments, a different object), and neither can a retry, since the checkpoint cursor points back at the same page.

A row is only a hit when its `sourceVersion` matches **and** its stored points match its own `pointCount`. The count is what separates an unreadable payload from a real one: the row parser answers "no points" for a payload it cannot decode, which is byte-identical to the negative-cache row a GPS-less activity legitimately writes, so without the cross-check one corrupt row would be served forever and its activity would vanish from every heatmap until the file was reprocessed.

Points are cached **pre-privacy**. Privacy zones are a live setting, so a cache that had already trimmed the route could never grow those ends back without re-downloading the file; trimming happens when the heatmap is built, from the settings in force then. The rows are never serialized to a client, and they hold the same coordinates the source file in object storage already does. A `sourceVersion` mismatch is treated as a miss rather than a stale hit, so changing how routes are built re-derives them instead of serving geometry the old rules produced.

Heatmap generation builds the pyramid, two routes serve it as tiles, the static image reads it directly, and **every map now reads it**: a surface draws the untiled `fitness_route_heatmaps` geometry until its first batch of tiles resolves, then draws the tiles instead. The blob is still written exactly as it always was — it is what frames the map before any viewport exists, what a heatmap with no pyramid falls back to, and what a browser that cannot fetch tiles keeps showing — so the two are complementary rather than sequential.

Only the all-activities/all-time variant builds a pyramid, because that is the one the heatmap UI asks for. Region is orthogonal: tiles are stored unclipped and a region is applied when they are served, so whichever region row wins the claim builds the same per-actor pyramid. Every other variant — a specific activity type, a yearly or monthly period — is left entirely on the blob path.

The client picks which rung to draw from the viewport, in `useHeatmapTiles`. It rounds UP to the smallest rung at least as detailed as the view, because a rung is simplified to one pixel AT ITS OWN zoom and drawing z12 tiles at view zoom 13 would magnify that simplification into view. Two unit conversions matter and both were wrong first: Mapbox and MapLibre report zoom on a 512px tile grid while the pyramid is built on 256px tiles, so GL's zoom is one level short of the pyramid's; and MapKit has no zoom at all, so it is derived from the region and the element width rather than through `getZoomLevelForBounds`, which walks integers and returns the FLOOR — feeding a floored value into a round-UP rule gives back a rung up to two levels coarser than the view.

A view routinely needs more tiles than one request carries, so batching is the normal path: the ladder steps by 2, and a view just past a rung rounds up nearly two levels — 273 tiles at 1280x720, 558 at 1920x1080 and 984 at 2560x1440 for a full-bleed embed, against a 128-tile request. `MAX_TILES_PER_VIEW` sits above all three deliberately, because a view that exceeds it is COARSENED — stepped down the ladder until it fits — and coarsening is not free: it draws the map a whole rung softer than its zoom asked for, which is the simplification this feature exists to remove. A ceiling below ~1000 would do that to an ordinary desktop map at every rung boundary rather than in some rare corner; a 4K map still coarsens, which is the right place for the trade to begin. Only a view that fits at no rung at all — a span of a whole world or more, which normalisation would otherwise collapse into a drawable sliver — falls back to the untiled geometry.

The cache is bounded twice, and the second bound is the one that matters. It must hold more than one view, which is a correctness bound rather than a tuning one: tiles are inserted batch by batch and eviction takes the oldest first, so a smaller cache would evict the batches a view had already fetched and assemble a map with holes it cannot detect. But a tile COUNT is a poor proxy for memory — the format deliberately has no per-tile point ceiling, and a decoded vertex is a `{lat, lng}` object measured at ~82 bytes, so two thousand dense city tiles are over 200 MB. So the cache is also capped by total vertices, and eviction never touches a tile the current view needs: a single dense view can exceed the vertex budget on its own, and evicting from it would produce exactly the holes the first bound exists to prevent.

Tiles REPLACE the untiled geometry rather than drawing over it: the two describe the same roads at different fidelities, so together every line renders at twice its opacity. The swap happens only once a batch resolves, so a pan never blanks the map, and a failed fetch leaves the previous view standing — tiles are detail on top of geometry the surface already drew.

Two routes serve the pyramid AS TILES: `GET /api/v1/accounts/[id]/fitness-route-heatmap/tiles` for the signed-in owner, and `GET /embed/heatmap/[token]/tiles` for a public share. (A third reader, the static share image, queries the tile rows directly rather than through either route — see The static share image below.) Both take a ladder zoom and a list of `x:y` indices (at most `MAX_TILES_PER_REQUEST`, rejected rather than truncated so a client cannot silently render a map with holes it has no way to notice) and answer `{version, tiles}` — one entry per requested index, `null` for empty, clipped away, or unavailable. A heatmap that has tiles says so with a `tileSource` on its own payload: the version its URLs must carry plus the ladder, which is null unless the row is the all-activities/all-time variant AND the actor's pyramid has completed a build.

The public route refuses more than it clips. A share token resolves to a heatmap ROW, and that row carries three axes of scope — sport, period and region — of which the pyramid answers only the third. So the route asks `buildHeatmapTileSource` the same question the pages ask before advertising tiles, and a null answer is a 404: a share cut down to "runs in 2019" is not served from a store covering every sport and every year. Region clipping cannot catch that one, because such a share is usually world-wide. Deriving the refusal from the same helper the pages use, rather than re-deriving the conditions, is deliberate — the gate first shipped on the pages and missing from the route, which is precisely the drift one predicate prevents. It also decides `activityType` by testing for null rather than for falsiness, matching the job's own gate: a stored empty string would filter to nothing in the job while reading as "no filter" here, which is the disagreement that serves a whole history behind a row showing none of it. The OWNER route has no equivalent gate and needs none — its request names a region and nothing else, so there is no variant for it to contradict.

Neither route reads the share's geometry. `segments` on that row is the entire untiled heatmap, and a panning viewport hits these routes many times; a summary-shaped read (`getFitnessRouteHeatmapSummaryByShareToken`) takes the actor, status, scope and region and leaves the megabytes on disk. The two routes also share one query parser, which is not tidiness: they had already drifted, resolving `?z=4&z=16` differently (`Object.fromEntries` takes the last value, `searchParams.get` the first) and disagreeing on a malformed `v`. Neither divergence leaked anything, but two routes that must behave identically disagreeing about how a query is read is how the next scope-bearing parameter becomes a leak.

Only a `completed` pyramid serves anything, and only tiles stamped with its own version. A build in flight has two versions in the table at once — the previous build's wherever it has not reached, and its own partial ones — and drawing those together shows heat that no build ever produced. The version filter also catches what the sweep failed to: completion and the sweep are separate steps, so a build that completes after its sweep throws leaves exactly those leftovers behind. The `v` request parameter is a cache-buster and never a tile filter: a well-formed version that has since moved is answered with the current tiles and the current version, because refusing it would blank a map the instant a rebuild finished underneath a client still holding the previous `tileSource`. A malformed one is a 400 on both routes — a client that believes it is busting a cache with a value the server cannot read should be told, not quietly served from the entry it meant to bypass.

**On the public route, clipping to the shared row's region is the security boundary.** The pyramid covers the actor's whole history; a share covers one rectangle of it, and the caller sends tile indices and nothing else. Without server-side clipping a rect share is a lookup oracle for everywhere its owner has ever been. Tiles whose coordinates put them outside the region are settled before any read; a boundary tile is clipped vertex by vertex through the untiled heatmap's own `splitSegmentByBounds`, so the result cannot contain a point the region does not, and a run left with a single vertex is dropped because it draws no line and its presence alone would leak that something was there. The classification may be pessimistic — a union of rects covering a tile reads as straddling and clips to the same geometry, just more slowly — but never optimistic.

The region resolver fails closed, which is subtler than it sounds. `getRegionBounds` answers an empty list both for the whole world and for a region string it could not parse a single rectangle out of, and an empty list means "clip nothing" everywhere downstream — so a rect share whose stored token failed to parse would hand back the world pyramid it was cut from. Only the empty string, the world sentinel `serializeRegions` emits, reaches the unclipped path; any other region that resolves to no bounds is a 404, and the resolution runs ahead of the conditional-request check so no response — 200 or 304 — can be produced without it. A writer really could produce one, which the review of this change is what established: `serializeRegions` validated a rectangle BEFORE rounding it to two decimal places, so a box thinner than 0.01° passed the check and then collapsed, and the token it emitted deserialized to nothing — world scope to every consumer. The generation job built the actor's whole unclipped history under it, while the share page titled it "Map area" (or the owner's saved label): a collapsed token is not the world sentinel, so the page did not call it the world, and it deserializes to no rectangles, so there was no bounding-box caption to contradict that either. Nothing a viewer could see said world. The rectangle's own bounding box does appear on the OWNER's heatmap page, whose region rows format the box they hold rather than the token they serialize to — which is how one row could read as a small area there and as an unnamed one on the share. Serialization now validates the rounded box, so such a scope becomes the world sentinel and is labelled as the world, and the region picker refuses to save a box that would collapse rather than letting it silently take the world's key. Rows written before that are still out there, and for them the job already baked the whole world into `segments` — there is nothing left to clip, so every PUBLIC surface refuses to render one: the share page, the embed page, the embed image and the embed tiles route. The OWNER tile route is deliberately not among them — it clips to the region its own caller sent, having authenticated that caller as the actor whose history it is. No backfill is performed; such a row keeps its data and simply stops being publishable. The refusal would stay regardless, because the cost of being wrong is asymmetric: a false refusal costs the whole share — page, embed and image all 404 — while a false pass publishes an actor's entire history. That asymmetry got sharper when the refusal moved onto the pages, which is worth stating plainly rather than leaving the older, gentler framing in place: this is no longer just about losing zoom detail.

The public route also strips the privacy class from every run while keeping its geometry, through `flattenTilePrivacyForPublic` — deliberately placed beside the untiled `flattenPrivacySegmentsForPublic` so both public surfaces answer to one doctrine rather than drifting apart. And it re-encodes every byte it returns: the owner route may forward a stored payload verbatim for a tile that needed neither clipping nor stripping, but a public response is always rebuilt from segments the decoder was willing to accept. Responses are cacheable for five minutes with a weak `ETag` of the pyramid version, matching the sibling image route's posture — the share URL is a capability that can be revoked, and the TTL bounds how long a CDN keeps serving what it already has.

Each activity is folded through `lib/services/fitness-files/heatmapTiles/`, which quantizes its polyline to one unit per screen pixel at each zoom on the ladder and reduces it to a set of undirected edges. An activity contributes each edge exactly once, so the stored count is the number of distinct activities that used a stretch of road, and 1-pixel quantization is what makes GPS-jittered repeat rides snap onto the same edge instead of accumulating parallel lines. Deltas are folded into an in-memory map and merged into tile rows at a flush, never per activity: without a per-tile cap a downtown tile's edge set grows without bound, and exploding and reassembling it once per activity is quadratic in exactly the tiles that matter most.

**Tile counts accumulate, which makes resuming the delicate part.** Re-folding an activity inflates its heat permanently — a wrong number rather than a missing one, and unlike a missing tile nothing later notices. Three rules keep that from happening, and each answers a way the naive version got it wrong.

_A build only completes over a history it actually scanned._ The count it is measured against is taken immediately before the decision, not from the start of the pass, because an activity that finished processing in between is invisible to both a stale count and the page query that ran with it. Certifying a short scan is worse than the tiles it misses: `completedAt` is what makes the next claim answer `already-fresh`, so a regenerate requested before that completion would be refused and the hole would become permanent. Such a pass hands the build back instead, and the cost is a rebuild that nothing schedules. Route heatmaps are generated on a user action or by `scripts/fitness/recreateFitnessRouteHeatmaps.ts` — an upload does not enqueue one — so a build discarded because an activity arrived mid-run waits for the next time somebody presses Generate. If a second Generate is what caused the discard, that job is itself refused `build-in-progress` while the chain is still running, and by resetting the region row it makes the in-flight continuation stale, so neither of the two builds a pyramid. Resuming on the build's own keyset cursor is what removes the discard; nothing re-enqueues a handed-back build today.

_A build folds an activity only if its own cursor says it has not already._ The scan runs newest-first and the build records the last file it took, so anything sorting at or after that cursor is skipped. Asking where a file sits, rather than counting how many came before it, is what makes the fold idempotent: a page redelivered after a crash, an offset that shifted because an activity was uploaded between two passes, a checkpoint whose progress write was lost — each re-presents files the build has already seen, and a counter cannot tell any of them from honest progress. It guards that direction only: the scan is still the legacy integer paging, so an activity _deleted_ from the part already scanned shifts every later row up an offset and the file between is never presented to the gate at all. That hole is inherited — the legacy blob skips the same activity in the same run — and the coverage check does NOT catch it: a deletion lowers the recount by the same one the shift skipped, so the pass looks exactly as covered as it would have been. Such a build completes, missing one activity, until the next full generate rebuilds from the beginning. The check catches the opposite shift, an activity ADDED while the build runs, where the recount rises above what the scan reached — but only while that rise survives to the decision. The recount is taken after the scan, so a deletion landing between the final page read and it cancels the addition's shortfall exactly, and the build completes having re-presented a file. That is the window the fold's own `foldedThisFile` guard exists for, and it is why that guard is not redundant with this check. Closing the deletion half properly means resuming on the build's own keyset cursor, which is what retires the legacy paging.

The cursor advances for every file the pass finished with, GPS or not, so a treadmill session at the front of a history does not leave it stuck — and a file whose download or parse threw advances it too. That last case is not tidiness: a build with no cursor cannot be resumed, so a first pass whose every readable file threw (a storage outage, which is also how the time budget gets consumed) would hand its own continuation a token the claim then refuses, and every later pass carries a non-zero offset and can start nothing either. The pyramid would simply never be built.

_A build is either fresh or continuing, and only a token proves which._ Keeping a build's version — adding to its tiles instead of replacing them — is safe only for a pass carrying on from where that build left off, so resuming requires presenting the build's own token. A caller's say-so is not enough and was the hole that shipped: the heatmap API sets `resume: true` on any retry of a failed or partial region row, carrying that row's offset and no pyramid token, and a run like that would adopt an abandoned build, skip every activity before its offset and then mark the pyramid completed over the hole — with the version unmoved, so the sweep could never clear it.

Such a pass does not claim at all. Whether it could ever own a build is knowable from its job data — it needs either a token or a scan starting from the beginning — and that matters because the claim is destructive: its compare-and-swap bumps the version, stamps `generating`, and clears the counters, the cursor and `completedAt`. Claiming first and declining afterwards took a healthy completed pyramid to a failed, empty one over tiles it no longer described, and rebuilt nothing. A claimer scanning from the beginning without a token still gets a fresh version — a full rebuild that sweeps the old build away, which is merely wasteful where the alternative is silently wrong. And a pass that does end up holding a build it must not use hands it back rather than sitting on it: its claim has already stamped a fresh heartbeat, and a live-looking build with no writer blocks every other claimant until the staleness window lapses. That applies to every exit — a cancelled run, a continuation dropped because its region row moved on or was cleared under it (which holds the only copy of its build's token, so walking away strands the build _and_ refuses the Generate that displaced it), a run that stopped at the file page limit and so has no successor to finish what it started, a pass whose scan fell short of the history it was told to cover, and a pass that simply threw before it could claim.

Which is why the release for a build a pass was merely _carrying_ happens in one place — the handler's `finally` — rather than at each of those exits. Four separate guards drop a continuation, a per-guard release was missed on one of them twice, and none of them covers a throw between reading the token and making the claim. It runs unconditionally because it is fenced on the carried token and every claim moves that token: once this pass adopted the build, or anyone else took it over, the release matches nothing at all.

_A continuation carries the build forward in its job data._ Flushing _is_ the heartbeat, so the pass that just checkpointed leaves a fresh `generating` row that its own continuation would otherwise read as somebody else's live build, and no pyramid would ever outlive one checkpoint. What it carries names the pyramid ROW as well as the token, because `claimSeq` counts from zero per row and clearing an actor's heatmaps deletes the row — token 1 before a clear and token 1 after it are different builds, and that collision lands on the likeliest value of all. None of this bypasses the fence: the compare-and-swap still moves the token, so a continuation delivered twice has exactly one winner. A request from the API carries nothing and competes on the usual terms.

Tiles and the progress describing them land in **one** guarded statement, and the cursor advances as each activity is folded rather than after it, so the cursor a flush commits always covers exactly the tiles committed with it — including the flushes that fire part-way through an activity, which is routine rather than exotic: the accumulation guard trips on a plain point counter, so every large build hits it. The region row's checkpoint follows, leaving the pyramid at or ahead of it and never behind — the harmless direction, since anything the region row hands back a second time is recognised by the cursor and skipped. Every write names the pyramid **row** as well as the token, for the same reason the claim does, and that includes the completion sweep: it is the write that _deletes_, so unfenced a build sweeping at version 2 whose call landed after a clear removed the replacement build's version-1 tiles, and that build then stamped itself `completed` over tiles that were gone. The claim's compare-and-swap and the read that confirms it share one transaction, which is what makes the row it reports the row it wrote: a failure between them used to leave the row stamped `generating` at a token the caller never learned it held, and a rival claim or a clear landing there would have been reported as this pass's own build.

Sweeping is not part of completing, either, and it is the only irreversible step in the whole path. It runs after the guarded completion write has already stamped the row, and the release a completion failure triggers is fenced on a token that write does not move — so a sweep sharing the completion's error handling rewrote a finished, correct pyramid to `failed` over the tiles it had just certified. A build that could not READ every file it walked past is a different matter, and not one the sweep can fix. The count is carried across continuations with the build's token rather than accumulated on the row, so the pass that completes reports the whole build's losses and not just its own — the pass that finishes a long history is rarely the one that hit the outage. Such a build still completes — an unreadable activity is skipped by the legacy blob too, and refusing to complete would wedge any actor with one permanently missing object — but it records the loss in the row's `error` instead of implying there was none. Withholding the sweep was tried first and does not protect the missing geometry: tiles are one row per `(actorId, tileKey)` and a merge REPLACES a tile whose stored version is older, so the moment a readable activity folds into a tile the unreadable one's contribution to that tile is gone. Measured on a partial outage, that left 66 of 224 tiles untouched and still lost 37% of the points — and it blocked the sweep forever for an actor with a permanently unreadable file, so activities deleted since the last build never left the pyramid. The whole of it is isolated from the legacy blob: any tile-path failure — the tiler, a flush, the completion — abandons the build, records why on the pyramid row, and lets the run finish the heatmap the user can actually see. Two writes have nothing to record on and are only logged: the CLAIM, since it is a transaction that either happened or did not, and the completion SWEEP, which runs after the build is already `completed`. The claim's one gap is a commit whose acknowledgement is lost, which leaves a claimed row its caller never learns about and which waits out the staleness window like any build whose worker died.

The pyramid tables are also wired into deletion, and it is one transaction rather than two statements. Order alone is not enough in either direction: tiles first lets a running build write more of them before the row goes, and those carry a version no later sweep can reach; the row first fences that build, but on its own lets a _new_ one claim the freshly-absent row and flush tiles that the tile delete then removes, leaving a build that completes over nothing. The transaction also creates the pyramid row when the actor has none, because a delete matching no row takes no lock and so serialises nothing.

#### The static share image

`GET /embed/heatmap/:token/image` renders the still image the share dialog hands
out for embedding in another page, beside the interactive iframe. It draws from
the pyramid too, but it chooses its rung differently
from an interactive map: there is no viewport to read, so the rung comes from
the image's own size, along whichever axis the renderer fits by. `buildHeatmapSvg`
fits a projected box with `min(innerWidth / spanX, innerHeight / spanY)`, so a
tall scope in a wide frame is limited by its height — measured in projected
units rather than degrees, because a degree of latitude is not a fixed number of
pixels in Mercator and at 52 degrees north it is about 1.6 times a degree of
longitude. Reading longitude alone asks for a rung finer than the image can draw
and reads tiles nobody sees. The keyless SVG renderer shades each stroke by visit
count from the same `heatOpacityForCount` ramp the interactive maps paint with,
so a road ridden thirty times reads darker than one ridden once; the two basemap
renderers draw every stroke at one flat opacity and ignore the count.

The image path enforces the same two boundaries the tile routes do, because
every path that reads the pyramid has to enforce them again: it refuses a share
`buildHeatmapTileSource` answers null for, and it clips each tile to the shared
row's region. Every failure keeps the stored blob — no completed build, a read
that throws, or a pyramid holding nothing for this view — because a stale image
beats no image and a pyramid outage should not take out a working share link.

That blob is still load-bearing for a second reason. Tile geometry is one run
per way per tile where the blob is roughly one polyline per activity, and both
basemap renderers are built for the latter shape: Apple refuses an input past
its overlay ceiling outright, and Mapbox drops whatever overruns its URL-length
budget and then frames the image on only the overlays that survived — which,
since tile runs arrive in tile order, is one contiguous corner of the view. So
each renderer is offered the tiles first and the blob second and decides for
itself, and an instance keeps its basemap instead of trading it away for
fidelity it cannot draw. The keyless SVG renderer has neither limit and always
takes the tiles.

##### The link-preview card

The same route is what the public share page's `og:image` points at.
`/u/heatmaps/:token` publishes OpenGraph and Twitter card tags from
`generateMetadata`, and rather than adding a fifth public surface — each of
which would have to re-enforce the share guards for itself — the card reuses
`GET /embed/heatmap/:token/image` with `?w=1200&h=600&format=png`.

Both callers build that URL through one `buildHeatmapEmbedImageUrl`
(`lib/fitness/heatmapEmbedImageUrl.ts`) — the share dialog in the browser and
the card on the server — so the route's query shape has a single owner rather
than two implementations free to drift apart.

`format=png` is the part that makes a card possible at all. The two basemap
renderers already answer with raster bytes, but an instance with neither a
Mapbox token nor an Apple key falls through to the keyless renderer, which
serves SVG — and no link-preview crawler (X, Facebook, Mastodon, Slack,
Discord) renders SVG, so an `og:image` pointing at one produces a card with no
image rather than a broken one. The parameter is opt-in because SVG is what
that path has always served: it scales, and the embed snippet the share dialog
hands out already points at the same URL. Anything but the exact string `png`
takes the default, so the parameter collapses onto two cache variants instead
of widening the surface `DIMENSION_STEP` exists to bound, and a rasterization
failure degrades to the SVG rather than 500ing — a browser still draws it, and
the crawler was going to ignore the image either way. The declared `1200x600`
is what the route will actually serve, since each axis snaps to a step of 100
and a requested 630 would come back as 600; only the Apple path differs, at
1280x640 for the same 2:1 ratio.

Everything the card says — the region title, the owner's name and handle, the
generated date — comes from the same `buildSharedHeatmapView` the page renders,
through one `cache()`-memoized `loadSharedHeatmap` shared by `generateMetadata`
and the page body. The page's bounding-box caption is deliberately not among
them: as a card subtitle `TL 52.50°N 4.80°E → BR 52.30°N 5.00°E` reads as debug
output, and the map locates the share better than its corners do. A second lookup path would be free to
drift from the first, and the failure that matters is a card describing a share
the page refuses: a revoked token, a share re-queued for generation and a region
that cannot be resolved all 404, and each returns the bare metadata with no card
at all. The page keeps `noindex, nofollow` — the token is the secret, and a
shared heatmap turning up in a search index is the one outcome sharing it is not
meant to produce — which costs the card nothing, because crawlers read
OpenGraph without consulting robots directives.

Adding an activity could extend the pyramid incrementally at upload time rather
than requiring a full regenerate. The hook is reserved and the design allows it;
it is deliberately not built.

## Gear Tracking

Bikes, shoes and recording devices all live in `fitness_gears`, the parts bolted to a bike in `fitness_gear_components`, and the stretches during which each part was fitted in `fitness_gear_component_periods` (the first two tables added by `migrations/20260811000000_add_fitness_gear.js`; the device kind's identity and product-page columns by `migrations/20260813000000_add_fitness_device_gear.js`; the periods table by `migrations/20260826120000_add_fitness_gear_component_periods.js`).

**Lifetime distance is never stored.** A gear total is `SUM(fitness_files.totalDistanceMeters) WHERE gearId = ?`, and a component total is the same sum restricted to activities whose `activityStartTime` falls inside one of the component's `[addedAt, removedAt)` install periods — a null `addedAt` means "since the gear's beginning" and a null `removedAt` means "still installed". Both rollups reuse the same `deletedAt IS NULL` + `processingStatus = 'completed'` + `isPrimary` filter as `getFitnessActivitySummary`, so gear numbers line up with the fitness overview. Storing the totals instead would have to be reconciled on every back-dated upload, archive re-import, activity edit and delete; derived totals are always consistent with the calendar for free.

An activity with no `activityStartTime` — a GPX carrying no timestamps — counts toward its gear's total but only toward components with a period open on that side, because an activity that cannot be placed in time cannot be placed inside `[addedAt, removedAt)` either. A gear total may therefore exceed the sum of its components' totals. For the same reason such an activity is counted here but not by `getFitnessActivitySummary`, which additionally requires a non-null `activityType` and `activityStartTime` to group by.

`fitness_gears` columns: `id`, `actorId`, `kind` (`bike`, `shoes` or `device`), `name`, `brand`, `model`, `bikeType`, `weightKilograms`, `defaultSports` (a JSON-encoded array of canonical sport keys, in a `text` column so every backend behaves alike), `alertDistanceMeters`, `lastAlertedDistanceMeters`, `notes`, `deviceKey`, `productUrl`, `retiredAt`, and the usual timestamps with a soft-delete `deletedAt`.

- **`productUrl` belongs to every kind.** A bike, a pair of shoes and a recording device all have a manufacturer's page worth linking to, and each one's page renders it the same way — through `GearProductLink`, which shows the hostname (`moots.com`, not the whole URL) and falls back to a "No product page — add one" prompt that opens the gear form. The API accepts it on create and update for every kind, and only http/https: the value becomes an `href`, so `javascript:`/`data:` there would be a script injection, and a bare `garmin.com` would render as a link back to this instance. `getProductUrlHostname` re-checks the protocol at render time, because rows written before that validation existed never passed through it. Only a device's is ever pre-filled — `resolveDeviceGear` seeds it from the brand map when the import creates the row.

`fitness_gear_components` columns: `id`, `gearId`, `componentType` (named that way to avoid the MySQL reserved word `type`), `brand`, `model`, `serviceDistanceMeters`, `lastAlertedDistanceMeters`, timestamps and `deletedAt`.

`fitness_gear_component_periods` columns: `id`, `componentId`, `installSequence`, `addedAt`, `removedAt` and timestamps, with `UNIQUE (componentId, installSequence)`.

- **A part's install history is a list, not a single window.** `addedAt` and `removedAt` are not columns on the component: each stretch during which the part was fitted is a period row, and the component's own pair is derived from them — the first period's start and the _last_ period's end. They therefore still mean "when it first went on" and "when it last came off" (null while it is fitted), which is what every reader asks for. Retiring closes the open period at today; **Refit** (`POST /api/v1/fitness/gear/:id/components/:componentId/refit`) opens the _next_ period at today and leaves the closed one alone. `PATCH { removedAt: null }` is the different, precise operation of saying a retirement never happened — it reopens the last period — and PATCH's `addedAt`/`removedAt` reach only the outermost bounds, so an edit cannot make two periods overlap. Inverting one is a separate hazard, guarded in two places: the route checks each bound against the other end of the period it actually lands on (the component's own derived `addedAt`/`removedAt` come from two different periods as soon as a part has been refitted), and the write guards its own ordering too — because the route validates the periods it read, while the write resolves which period is first or last when it runs, and a refit arriving in between moves that target. Bounds landing on different rows each get an SQL predicate against the other end that row keeps; bounds landing on the same row (a component with one period) are written together with the ordering settled in code, since a predicate there would test the new start against the old end the same statement is replacing.

  The single window this replaced could not represent a part that comes off and goes back on. Clearing `removedAt` reopened the _original_ window, so a wheelset unretired after a winter on the shelf was credited every ride of that winter, and retiring it again did not take that back — it only closed the window at the new today. Periods make the gap explicit, and the components table shows one line per period in its Added and Retired columns so it is visible rather than inferred.

  Periods must never overlap, because the rollup joins them and would count an activity once per matching period. `UNIQUE (componentId, installSequence)` is what makes a concurrent refit safe: both requests read the highest sequence, both try to claim the next one, and one loses at the database. It is deliberately a _plain_ unique index rather than a partial `(componentId) WHERE removedAt IS NULL` — knex emits a partial predicate on PostgreSQL and SQLite but drops it on MySQL-compatible clients, where the remaining `UNIQUE(componentId)` would forbid a second period entirely.

- **Default sports** map an incoming activity to gear automatically. `lib/services/fitness-files/sportTypes.ts` owns the canonical keys (`ride`, `gravel_ride`, `mountain_bike_ride`, `ebike_ride`, `virtual_ride`, `run`, `trail_run`, `walk`, `hike`); gear stores those keys, and `fitness_files.activityType` is now stored in the same vocabulary. Matching still goes through `normalizeActivityTypeToSportKey` rather than comparing strings, because older rows keep whichever raw spelling their source file used until the backfill script sweeps them. A sport belongs to at most one of an actor's gears; claiming it moves it off whichever gear held it. `processFitnessFileJob` assigns gear once the activity type is known, and only when the file has none — a manual assignment always wins. This mapping is the **only** source of automatic attribution, and it is editable from two places: each gear's own form, and the **Default gear** section of the Strava settings page, which lists it as activity type → gear.
- **Retiring** takes gear out of the pickers and out of auto-assign; its total is frozen by the absence of new activities. Retired gear stays explicitly assignable, so old activities can still be attributed to a bike that has since been sold.
- **A gear's page shows its activities as the posts they were published as**, through the same `Posts` feed the timelines use — same body, same stat chip, same action row. A bike switches between **Components** and **Activities** with an in-page dropdown; shoes and devices have no components card and so go straight to the feed. The Activities stat tile counts activities while the feed shows the ones still posted, so the two differ by any activity whose post was deleted.
- **Recording devices are a third kind** (`kind: 'device'`, added by `migrations/20260813000000_add_fitness_device_gear.js`), and they share very little with a bike: no components, no default sports, no distance total, no service reminder and no retiring. A device page reports an activity count and a first-used date, then its activities — a head unit records rides and runs alike, so summing their distances would produce a number that means nothing.
  - `deviceKey` is the device's immutable **identity**, derived only from what the file recorded: `name:<lowercased, whitespace-collapsed deviceName>`, else `mfr:<brand key>` for a manufacturer the brand map knows, else nothing at all (and then no row is created). It is UNIQUE with `actorId` and is never rewritten. `name`, `brand`, `model` and `productUrl` are display overrides the owner may edit freely — keying on the name instead would fork a duplicate row the first time someone renamed "Garmin Edge 840" to "the Edge".
  - **Devices are system-created only.** `resolveDeviceGear` is the sole writer, called by the import jobs wherever they write the device columns; `POST /api/v1/fitness/gear` rejects `device` with a 422, because a hand-made row would carry no `deviceKey` and so would match no upload. `productUrl` is seeded from the brand map on creation, so the manufacturer link the activity page used to render inline moves onto the device row.
  - Deleting a device **releases its `deviceKey`** in the same transaction that soft-deletes it, alongside detaching `fitness_files.deviceGearId`. The unique index covers soft-deleted rows, so without that release the next upload from that device could never create a row again.
  - The device rollups **replace** the shared predicate's `isPrimary` clause with a per-ride-per-device rule. `isPrimary` answers the wrong question for a device: the same-ride merge groups files by time overlap and never looks at the device columns, so which file won says nothing about which device recorded it. Two devices on one ride leave two files and the non-primary one is the only record the second device left; one device that produced two files for one ride (a `.fit` beside a `.gpx`, a manual upload beside the Strava sync) also leaves two, and counting both would report the ride twice. So of the countable files sharing a `(statusId, deviceGearId)`, exactly one counts — the primary if that device owns it, otherwise the lowest id — and the rule never defers to a sibling that is itself uncountable, since a merge writes the primary as `pending`. The activity list applies the same predicate, so the count and the page can only ever differ by an activity whose post was deleted — still counted, but with no post left to render.
  - `fitness_files.gearId` never points at a device: `setFitnessFileGear` rejects one, so an activity cannot be attributed to the thing that recorded it (which would leave it out of every rollup at once).
  - Existing history is linked by `scripts/fitness/backfillFitnessDevices.ts` (dry run by default, `--apply` to write).
- **Strava's own gear is deliberately ignored.** Neither the webhook import (`activity.gear_id`) nor the archive import (the `Activity Gear` column and `bikes.csv`/`shoes.csv`) reads gear from Strava, and neither ever creates a gear row. Importing those values used to mint a local gear per Strava id or name, with a `kind` guessed from an undocumented id prefix or an optional CSV — and `kind` is immutable, so a wrong guess could only be fixed by deleting the gear and detaching every activity on it. An imported activity is attributed the same way an uploaded one is: from the owner's default-sport mapping.
- **Service reminders** compare the derived totals against `alertDistanceMeters` (shoes) and `serviceDistanceMeters` (components), recording the distance they fired at in `lastAlertedDistanceMeters` so each crossing notifies exactly once — the claim is a conditional write, so two concurrent evaluations produce one notification rather than one each. Raising a threshold, replacing a part, or retiring and unretiring re-arms it. They are evaluated when a total can change — after an activity is marked `completed`, and when one is attributed by hand — because this instance has no recurring job infrastructure; the queue can delay a message but not repeat one. Evaluating before the `completed` write would read the total from before the activity that caused the crossing.

## API Endpoints

### Upload and Retrieval

- `POST /api/v1/fitness-files` uploads a fitness file through multipart form data.
- `GET /api/v1/fitness-files/:id` returns the original uploaded file content. **Owner only** — every other request, signed in or not, gets a `404` whatever the attached status's visibility (see Security and Privacy). Responses are `private, no-store`, `nosniff`, and `Content-Disposition: attachment`.
- `PATCH /api/v1/fitness-files/:id` attributes the activity to a piece of gear, or clears it with `{ "gearId": null }`. Owner only; every rejection is a `404`, including a gear id that is not the owner's, so the response cannot confirm that an id exists.
- `GET /api/v1/fitness-files/:id/route-data` returns parsed route samples and analysis series for status detail maps and charts.
- `GET /api/v1/fitness-files/by-status?statusId=...` returns fitness files attached to a status.
- `DELETE /api/v1/accounts/fitness-files/:fitnessFileId` deletes an uploaded fitness file.

### Account Fitness Data

- `GET /api/v1/accounts/:id/fitness-summary`
- `GET /api/v1/accounts/:id/fitness-calendar`
- `GET /api/v1/accounts/:id/fitness-activity-types`
- `GET` and `DELETE /api/v1/accounts/:id/fitness-route-heatmaps`
- `GET`, `POST`, and `DELETE /api/v1/accounts/:id/fitness-route-heatmap`
- `GET /api/v1/accounts/:id/fitness-route-heatmap/tiles` returns the owner's own pyramid tiles for a view. Owner only, bounded per request.
- `POST` and `DELETE /api/v1/accounts/:id/fitness-route-heatmap/share` mint and revoke the share token the public views are reached by.

The `POST /api/v1/accounts/:id/fitness-route-heatmap` body takes an optional `retry` flag to restart a run and a `cancel` flag to stop an in-flight (`pending`/`generating`) generation. Cancelling moves the run to a terminal `cancelled` state (resetting its progress so a later Generate/Retry starts clean) and returns `{ cancelled }`; the region detail view surfaces Cancel while generating and Retry once cancelled.

The older `/fitness-heatmap` and `/fitness-heatmaps` endpoints are compatibility adapters for route heatmaps. They call the route-heatmap handlers, then return legacy flat payloads with `imagePath: null`; route heatmaps now store serialized route segments, not generated PNG heatmap images.

### Settings and Imports

- `GET` and `POST /api/v1/fitness/general`
- `POST /api/v1/fitness/general/regenerate-maps`
- `GET`, `POST`, and `DELETE /api/v1/fitness/strava`
- `GET /api/v1/fitness/strava/authorize`
- `GET /api/v1/fitness/strava/callback`
- `GET`, `POST`, and `PATCH /api/v1/fitness/strava/archive`
- `POST /api/v1/fitness/strava/archive/presigned`
- `POST /api/v1/fitness/import`
- `GET` and `POST /api/v1/fitness/import/:batchId`
- `POST /api/v1/webhooks/strava/:webhookToken`

### Gear

Every gear endpoint is owner-scoped, and answers `404` rather than `403` for anything the signed-in actor does not own.

- `GET` and `POST /api/v1/fitness/gear` — list and create. Each list entry carries its derived rollup, batched into one grouped query **per kind**: bikes and shoes report `distanceMeters` and `activityCount`, devices report `activityCount` and `firstUsedAt` (with `distanceMeters` fixed at 0). `POST` accepts only `bike` and `shoes` (and takes `productUrl` alongside the rest of the form's fields); a `device` is a 422.
- `PATCH` and `DELETE /api/v1/fitness/gear/:id` — `kind` is immutable, and so is a device's `deviceKey`. `productUrl` is accepted for every kind — unlike `bikeType`/`weightKilograms`, which are bike-only, and `alertDistanceMeters`, which is shoes-only. Deleting soft-deletes the gear, nulls `gearId` and `deviceGearId` on its activities, and releases the device key — all in the same transaction.
- `POST /api/v1/fitness/gear/:id/retire` — one idempotent toggle taking `{ "retired": true | false }`, rather than separate retire and unretire verbs. A device is a 422: retiring means "out of the pickers and out of auto-assign", and a device is in neither.
- `GET /api/v1/fitness/gear/:id/activities` — a page of the activities attributed to this gear, newest first, **as the posts they were published as**, matching on `deviceGearId` for a device and `gearId` for everything else. Takes `limit` (default 20, clamped to 1–100) and `offset`, and answers `{ statuses, hasMore, nextOffset }`: `statuses` is the app-domain `Status` shape the timelines render, loaded in one batched read and hydrated for the caller. `hasMore` comes from fetching one row past the page rather than a second COUNT over a history that can run to five figures. `nextOffset` counts ACTIVITY ROWS, not the statuses returned — deleting a status only nulls `fitness_files.statusId`, so a row with no post left still occupies an offset, and paging from `statuses.length` would re-request everything in between.
- `GET` and `POST /api/v1/fitness/gear/:id/components` — a device is a 422 on every component endpoint; it has no parts to service.
- `PATCH` and `DELETE /api/v1/fitness/gear/:id/components/:componentId`
- `POST /api/v1/fitness/gear/:id/components/:componentId/retire` — closes the fitted part at today's date; the successor is added explicitly through `POST .../components`.

### Map Provider Tokens

- `GET /api/v1/fitness/apple-maps-token` returns a short-lived (30 minute) signed MapKit JS token used to initialise Apple Maps in the browser. It responds `404` unless `ACTIVITIES_FITNESS_MAP_PROVIDER=apple`.

This endpoint is **anonymous / unauthenticated** on purpose: public embeds and shared heatmap pages render maps for logged-out visitors, so there is no session to authenticate against. Abuse of a leaked token is bounded by the token's `origin` claim, which is restricted to this instance's own origins (`ACTIVITIES_HOST` plus any trusted hosts) and compared by MapKit against the browser's `Origin` header. Responses are sent with `Cache-Control: no-store` so no intermediary cache or CDN stores and replays the credential.

## Processing Pipeline

1. The post box uploads the selected fitness file and attaches its ID to a new status.
2. `processFitnessFileJob` downloads the stored file, parses `.fit`, `.gpx`, or `.tcx` data, and updates the `fitness_files` metadata.
3. Privacy locations from fitness settings are applied before route maps or route-data responses expose coordinates. They trim the route's **head and tail only** — never its middle. When an end of the route falls inside a zone, points are dropped from that end until one is both outside every zone and at least that zone's hide radius along the recorded track, measured as cumulative point-to-point distance; the largest radius wins when zones overlap, and an end that sits in no zone is not trimmed at all. Everything between the trimmed ends is exposed as one unbroken line, **including where the route passes back through a zone**. That is a deliberate exchange: hiding each pass individually punched a circular gap into the polyline at every re-entry, which pinpointed the private location at least as precisely as the coordinates did, and it fragmented one activity into several disconnected lines. If no qualifying point exists on an end, or the two trims cross, nothing is exposed and no route map is produced. (Trims that meet exactly leave a single point, which is not a drawable route either.)
4. If visible GPS coordinates remain, a route map is rendered to a PNG buffer and stored as media — re-encoded to WebP, the default for every stored image — then inserted as the first status attachment named `Activity route map`. When the import is an unattended one that emails the owner, a JPEG copy of the same map is stored for that email and recorded in `mapImageEmailPath`.
5. A route map that cannot be rendered or stored does **not** fail the import — a post without a map beats no post, so the status keeps its text, its parsed stats, and its federation, and the file stays `completed`. The failure is recorded rather than swallowed: the reason goes to `fitness_files.mapError` (and to the log as a `logger.error` carrying the error object, so error reporting gets a stack). The post then offers its owner a retry, which re-runs this job. A first import still notifies the owner, because the activity itself did arrive; its email simply carries no map image. `regenerateFitnessMapsJob` records a failed regeneration the same way, and additionally keeps the map the file already had — that run produced no replacement, so removing the old one would turn a failed regeneration into data loss.
6. Empty fitness posts are backfilled with an activity summary.
7. The status is published to followers and route heatmap cache jobs are queued.

**When a post created by `importFitnessFiles` is stamped depends on why the import ran.** Every bulk path — the Strava archive walker, a multi-file upload, the retry-all endpoint and the `scripts/fitness` recovery tools — backdates the status to the earliest target activity's start time, falling back to the fitness file row's own `createdAt` (the upload moment) when the parse yielded no start time at all, as a GPX carrying no timestamps does. The URI tail is a v7 `publicId` minted from whichever of those two the import resolved, so it always sorts with the post. The **Strava webhook** is the single caller that opts out, through `postAtImportTime`: it fires minutes after a ride ends and its post is the news that the ride happened, so backdating buried a four-hour ride four hours down the timeline, below everything published while it was still being ridden. That is deliberately unconditional: Strava fires `create` for a late device sync, a back-dated manual entry and a bulk file upload as well, and none of them is treated differently, so restoring a season of old rides files them all at the top in upload order rather than chronologically. Only the stamp on the post moves — the recorded start time lives on `fitness_files.activityStartTime`, which is what the activity page and every fitness rollup read — and a webhook import that merges into a sibling's existing post (the same ride recorded on two devices) keeps whatever stamp that post already carries. Webhook imports are created and federated at the account's configured "Webhook Activity Visibility" (from fitness settings); the activity's Strava-side privacy setting is not consulted.

None of that governs the **streamless** Strava activity, which never reaches `importFitnessFiles`: an activity with no positive duration and no streams gets `getOrCreateStravaFallbackNote` instead, which has always stamped the post at import time on every caller (`createNote` defaults to now) and mints its URI tail as a deterministic sha256 of the actor and Strava activity ids rather than a `publicId`, so that a re-import finds the same status instead of duplicating it.

Reprocessing a file (a retry, a recovery script, a re-import) attaches its new route map first and removes the previous attachment and media only once that replacement is stored — the other order turns a failed reprocess into data loss, leaving an activity that had a map with none at all. Removing it at all is what stops the post rendering the same route twice, and what stops a stale image — which no column points at any more — from showing a route a privacy location added since would have hidden. A cleanup that fails while replacing a map is logged and leaves a stale attachment: the replacement is already stored, so it costs a leftover and nothing more, and a retry would attach a third map rather than remove the second — `scripts/maintenance/cleanupMediaStorage.ts` reclaims the bytes. When the removal is the whole point, though — a privacy location now leaves no exposed route — a failure IS recorded in `mapError` and the file keeps pointing at the map it could not remove: there a retry re-attempts exactly that removal, and until it succeeds the post is still showing the route the owner hid. Re-federating a changed map to remote instances is **Regenerate maps**' job — it is the only path that knows the status is live, since a file import creates local-only statuses and a first import that failed never published its Create.

## User-Facing Features

- Fitness upload button in the post box
- Fitness activity status detail with route map, stats, device info, media, and analysis graphs
- Settings pages for storage usage, file management, default visibility, Strava, privacy locations, and route map regeneration
- Profile fitness dashboard and route heatmap view
- Strava OAuth and webhook imports
- Strava archive ZIP upload with progress, retry, and cancel support

## Maintenance Scripts

Fitness maintenance scripts live in `scripts/`:

- `scripts/fitness/importStravaArchive.ts`
- `scripts/fitness/resumeStravaProcessing.ts`
- `scripts/fitness/recreateFitnessRouteHeatmaps.ts`
- `scripts/fitness/fixStuckFitnessProcessing.ts`
- `scripts/fitness/diagnoseFitnessImport.ts` — read-only preflight: which database, actor, Strava settings/token, stored files, and same-ride overlap
- `scripts/fitness/repairFailedFitnessImports.ts` — re-runs failed **and** crash-orphaned imports (stuck at `pending` with no status after an uncatchable OOM/SIGABRT)
- `scripts/fitness/importStoredFitnessFile.ts` — rebuilds a post from the already-stored file with no Strava call (deleted-from-Strava case); merges same-ride files into one post
- `scripts/fitness/repairStravaActivityFiles.ts` — pass `--delete-missing` to hard-delete activities Strava 404s (default: report only; deletion is irreversible)
- `scripts/fitness/backfillFitnessMovingTime.ts` — recomputes `movingTimeSeconds` for already-stored files so their average pace/speed switches from elapsed-time to moving-time (matching Strava); idempotent, supports `--dry-run` and `--force`
- `scripts/fitness/importFitnessGear.ts` — creates gear and component history from a JSON file and attributes existing activities to it, by Strava activity id or file name where the file names one and by `activityStartTime` otherwise, for activities imported before gear tracking existed; reports the activities left with no gear, which is what a gear total short against Strava is short by; idempotent, supports `--dry-run`, `--overwrite` and `--tolerance-seconds`
- `scripts/fitness/convertStravaExportToGearImport.ts` — builds that import file's assignments from a Strava export's `activities.csv` (the only record of which gear each historical activity used), merged with a hand-authored gear description
- `scripts/fitness/backfillFitnessDevices.ts` — links already-stored activities to a `kind: 'device'` gear row, resolved from the `deviceName`/`deviceManufacturer` they were recorded with; dry run by default, `--apply` to write, idempotent
- `scripts/fitness/normalizeFitnessActivityTypes.ts` — collapses stored `activityType` values to canonical activity types (`ride`, `run`, `swim`, `training`, `rowing`, `yoga`, `climbing`, `ski`, `skating`, `surfing`, `racket_sports`, `martial_arts`, `team_sports`, `golf`, and defaulting anything else to `other`), so the four source vocabularies stop splitting the fitness overview breakdown and the per-type heatmap cache; new imports are already normalized at parse time, so this is only for older history. Dry run by default, `--apply` to write, idempotent
- `scripts/fitness/retrigerStravaActivities.ts`
- `scripts/fitness/runImportStravaActivity.ts`
- `scripts/fitness/listStravaWebhooks.ts`

Every recovery script prints the resolved database target on start — check it is
your production host, since `.env.local` shadows `.env.production` even under
`NODE_ENV=production`.

See [Maintenance Scripts](maintenance.md) for general script guidance.

## Security and Privacy

- Fitness files can contain sensitive location data.
- Fitness posts default to private visibility in Strava flows unless the user chooses otherwise.
- **An activity's own Strava privacy setting is not carried over.** Every activity imported from Strava is posted at the actor's configured import visibility, including ones marked "Only you" or "Followers" on Strava. The default is safe — `private` at every layer, which is followers-only — but an actor who selects public or unlisted federates those activities world-readable, route map and stats included. The setting is disclosed in the Strava settings form, which warns when public or unlisted is selected; the archive upload is the one import path that does not read it and carries its own visibility instead.
- **One reader resolves that setting.** `resolveStravaDefaultVisibility` (`lib/services/strava/defaultVisibility.ts`) is what both the webhook route and the import job call. `fitness_settings.defaultVisibility` is a plain varchar whose row mapper asserts rather than parses, so a value the write path would have rejected can still be read back; anything that is not a visibility falls back to `private` and is logged. Before this was shared, the webhook route parsed and the job did not — and the job's arm is the one every retry and repair path takes.
- Privacy locations trim the head and tail of a route — not its middle — from route maps and route-data responses. A route that re-enters a zone part-way through is exposed there; see the Processing Pipeline above for why. When the trims leave no route, the map image is not rendered at all.
- **Route heatmaps are the exception, and always were: the trim changes what the owner's own view highlights, not what a public embed shows.** The heatmap cache stores the head/tail flag per activity — annotated per file, before the activities are pooled, so every activity's own ends are marked rather than only the first and last of the pool — and the owner's authenticated view renders those segments distinctly. `flattenPrivacySegmentsForPublic` then drops the flag for public and shared embeds while **keeping every coordinate**, deliberately: a hole where a route's ends should be pinpoints the private location as precisely as the coordinates do, so neither a gap nor a highlight is an option. Public heatmap embeds therefore render full near-home geometry, unchanged by this rule. See the comment on `flattenPrivacySegmentsForPublic` for the trade-off the instance owner accepted.
- **The uploaded file is owner-only, because trimming cannot apply to bytes the server merely stores.** `GET /api/v1/fitness-files/:id` serves the original `.fit`/`.gpx`/`.tcx`, which still contains the full track including the ends the map and route data trim — so serving it to a viewer handed back exactly what every other surface had just hidden. It used to answer any request whenever the attached status was public or unlisted, and three surfaces linked it for every viewer — the activity detail footer, the shared post's fitness card, and the fitness attachment card in a DM. All four are now restricted to the owner. **The file name is not**: it still renders for every viewer on each of those cards, because it is the card's label and what the multi-file selector switches between. Only the download goes — if you would not want the file name itself read by strangers, rename it or keep the activity below public visibility. Nothing federated is affected: the URL is stripped from every outbound payload and never appeared in an email.
- **Fitness objects must never be reachable through the media route, and `GET /api/v1/files/*` refuses them.** This guard is load-bearing, not defensive: with `ACTIVITIES_FITNESS_STORAGE_TYPE` unset — the default — fitness storage falls back to media storage _inside the media root_, under a `fitness/` key prefix in the same S3 bucket, or a `fitness` directory under `ACTIVITIES_MEDIA_STORAGE_PATH`. The media route has no access control at all and redirects to the public CDN hostname when one is configured, so without the reservation it is a way around the owner-only gate above. The reserved prefixes come from `getMediaReservedFitnessPathPrefixes` and cover the configurable `ACTIVITIES_FITNESS_STORAGE_PREFIX` as well; media objects are written under `medias/` — including route maps and their JPEG email copies — so nothing legitimate is caught.
- File type validation and quota enforcement prevent unsupported uploads and storage abuse.
- Anonymous public route-data responses rely on HTTP caching plus upstream deployment controls for flood protection. Configure a CDN or reverse-proxy rate limiter for `/api/v1/fitness-files/*/route-data` on self-hosted public instances.

---

## Contributor rules

Read the applicable rules and review checks below before changing this subsystem. The mandatory workflow remains in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

- [Fitness Stat Strips](#agents-fitness-stat-strips)
- [Apple Maps Basemap](#agents-apple-maps-basemap)
- [Fitness Activity Dates](#agents-fitness-activity-dates)
- [Fitness Route Heatmap Pyramid](#agents-fitness-route-heatmap-pyramid)
- [Fitness Gear](#agents-fitness-gear)
- [Review: Apple Maps basemap](#review-apple-maps-basemap)
- [Review: Fitness route heatmap pyramid](#review-fitness-route-heatmap-pyramid)

<a id="agents-fitness-stat-strips"></a>

### Fitness Stat Strips

- **Three stat strips render through `FitnessStatGrid`**
  (`@/lib/components/fitness/FitnessStatGrid`): the activity detail page's
  header strip (distance / moving time / avg pace / elev gain), the strip under
  its route map, and the inline fitness chip in a timeline post. Do not
  hand-roll a `grid-cols-*` strip beside them, and put a new fitness stat strip
  on this component rather than on a fourth threshold of its own.
- **Two strips are NOT on it yet**, so do not read the rule as describing the
  whole tree: the gear detail page's strip
  (`app/(timeline)/fitness/gear/[id]/GearDetailView.tsx` — still on a
  `sm:grid-cols-3`/`sm:grid-cols-2` **viewport** query, which is the same defect
  described below) and the fitness overview's totals
  (`app/(timeline)/fitness/ActorFitnessDashboard.tsx` — container-queried, but
  hand-rolled on its own `@2xl/fitness` threshold). Migrating them is a
  worthwhile follow-up; until then this section describes three strips, not
  every one.
- **The column rule is a CONTAINER query, never a viewport breakpoint.** The
  design system's `FitnessKit.StatGrid` and `FitnessChip` grids measure their
  own width with a `ResizeObserver` for the same reason `useCompactActionBar`
  does on the post action row: a strip can sit in a narrow column on a wide
  window. The old `sm:grid-cols-4` looked at the viewport, so on a tablet the
  detail page kept four `text-[28px]` tiles side by side in a 565px column and
  wrapped "31.1 km/h" onto two lines, while a chip in a wide column stayed
  needlessly 2-up at any window under 640px.
- The two variants differ, and it is the type size that separates them.
  `detail` is 1-up, 2-up from **420px** and 4-up from **780px** (values are
  21–28px, so a cell needs ~200px). `chip` is 2-up and 4-up from **424px**
  (`text-sm` values fit four cells in 4×100px + 3×8px of gap) and never drops to
  one column — a 4-row chip in a feed is a worse trade than a slightly tight
  cell.
- The detail page's two strips measure **separately** — the header one sits
  inside the card's `p-5` and is 42px narrower than the one under the map — so
  they can legitimately differ by one step in a narrow band of window widths.
  That is the rule working on real available width, not drift.
- `@container` goes on a **wrapper**, never on the grid itself: a container
  query styles a container's descendants, not the container, so a grid cannot
  both establish the container and read it. Guarded by
  `lib/components/fitness/FitnessStatGrid.test.tsx`.

<a id="agents-apple-maps-basemap"></a>

### Apple Maps Basemap

- **Every Apple-rendered map draws the `mutedStandard` basemap, interactive and
  static alike.** The four MapKit components (`ActivityRouteMapKit`,
  `RouteHeatmapMapKit`, `RegionMapKit`, `PrivacyZoneMapKit`) pass
  `mapType: mutedStandardMapType(mapkit)` to `new mapkit.Map(...)`, and the Web
  Snapshot URL that renders stored route images carries the same basemap as
  `t=mutedStandard` (`lib/services/fitness-files/appleMapsSnapshot.ts`). It is
  the standard road map with its land, water and POI colours de-saturated, which
  is the same reason the GL providers render heatmaps on `light-v11` /
  `positron`: the route lines, heat runs and privacy circles drawn on top have to
  stay the most prominent thing on the map. Do not give one surface its own map
  type, and do not re-enable `showsMapTypeControl` — a reader switching to
  satellite loses that contrast.
- **`mutedStandardMapType` falls back to the literal on purpose.**
  `mapkit.Map.MapTypes` is a static of the `map` library rather than of
  `mapkit.core.js`, and every component builds its map inside a `try` that drops
  the whole map to the static/OSM fallback renderer on throw — so reading
  straight through an absent `MapTypes` would trade a purely visual option for no
  Apple map at all. The enum member is defined as exactly
  `MAPKIT_MUTED_STANDARD_MAP_TYPE`, so the fallback renders identically. The test
  double carries the real static, so the components exercise the enum read.
- The snapshot module keeps its own copy of the literal rather than importing the
  component one: it is server-only (`lib/services/**`) and must not reach into
  the client component tree — see **Server/Client Module Boundary**.
- Changing the basemap does **not** restyle already-stored route images. They are
  re-rendered only by **Regenerate maps for old statuses** (`/fitness/privacy`,
  `POST /api/v1/fitness/general/regenerate-maps`).

<a id="agents-fitness-activity-dates"></a>

### Fitness Activity Dates

- **A fitness post's `createdAt` is NOT the activity's start time — read
  `fitness_files.activityStartTime`.** A post created through
  `importFitnessFiles` was backdated to the earliest target activity's start —
  or, with no parsed start time, to the fitness file row's own `createdAt` —
  until the Strava webhook opted into `postAtImportTime`
  (`lib/jobs/importFitnessFilesJob.ts`), which stamps the status when the import
  publishes it so a just-finished ride is not filed hours down the timeline
  behind everything posted while it was still being ridden. It does that for
  ANY activity the webhook delivers, however old — Strava fires `create` for a
  late device sync and a back-dated manual entry too. Every other caller still
  backdates, because each replays history. Do not read any of that as "the two
  used to be equal" and derive one from the other for old rows: they already
  diverged for a merged multi-device activity whose primary file is not its
  earliest (`createdAt` follows the earliest start, `status.fitness` follows
  `isPrimary`, and the primary is the LONGEST outdoor file), for a file whose
  parse yielded no start time at all, and for the streamless Strava fallback
  note, which never reaches `importFitnessFiles` and has always been stamped at
  import time. Anything rendering, sorting or grouping by "when the activity
  happened" therefore has to read the file, not
  the post: `FitnessStatusDetail`'s date, the import email
  (`fitness?.activityStartTime ?? status.createdAt`) and
  `getActivityImportGroupKey` all do. The status payload carries
  `StatusFitnessFile.activityStartTime` precisely so a surface holding only a
  status has it — the detail page's placeholder used `status.createdAt` as a
  stand-in and silently started dating rides wrongly the moment those two
  diverged. The post's own `createdAt` remains correct for what it means: when
  the post was published, which is what the timeline, the relative timestamp and
  the ActivityPub `published` should show.

<a id="agents-fitness-route-heatmap-pyramid"></a>

### Fitness Route Heatmap Pyramid

- **Tile visit counts ACCUMULATE, so an activity must be folded into a build
  exactly once.** Folding one twice inflates its heat permanently, and unlike a
  missing tile nothing downstream can detect it — the number is wrong, not
  absent, and if the build's `version` never moved then completion's stale sweep
  can never clear it either. Every rule below exists for that one hazard.
- **The fold gate is POSITIONAL, never a counter.** A build folds an activity
  only when its own `(createdAt, id)` cursor says it has not already, with the
  scan running descending. Counting scanned files cannot tell honest progress
  from a page already seen — a redelivered page after a crash, an offset shifted
  because an activity was uploaded between two passes, a lost progress write all
  look identical to a counter. It guards the double-fold direction only: the
  scan is still the legacy integer paging, so an activity DELETED from the part
  already scanned shifts every later row up an offset and the file between is
  never presented to the gate at all. That hole is inherited (the legacy blob
  skips the same activity in the same run) and heals on the next full generate;
  closing it means resuming on the build's own keyset cursor.
- **The cursor advances for every file the pass finished with, GPS or not, and
  it advances WITH the fold.** With, rather than after, because a flush can fire
  part-way through an activity and writes its tiles and cursor in one statement.
  For every file, including one whose download or parse threw, because a build
  with no cursor cannot be resumed — so a pass whose files all threw would hand
  its own continuation a token the claim then refuses, releasing the build, and
  every later pass in the chain carries a non-zero offset and can start nothing
  either. That is why the advance lives in a `finally`, not at the end of the
  `try`.
- **Resuming a build requires presenting its token, not declaring an intent.**
  Keeping a build's `version` means adding to its tiles, which is safe only for
  a pass carrying on from where that build left off. `resume: true` on a job is
  NOT that: the heatmap API sets it for any retry of a failed or partial region
  row, carrying that row's offset and no pyramid token.
- **A pass that provably cannot own a build must not CLAIM one.** Only a pass
  scanning from the beginning or carrying the build's token can cover what a
  build promises, and both are knowable from the job data before the claim —
  which matters because the claim is destructive: its compare-and-swap bumps
  `version`, stamps `generating`, and clears the counters, the cursor and
  `completedAt`. Deciding afterwards is too late; a routine region-row retry
  took a healthy completed pyramid to a failed, empty one over tiles it no
  longer described, and rebuilt nothing. A claimer at offset zero with no token
  still gets a fresh version — a full rebuild that sweeps the old build away,
  which is merely wasteful where the alternative is silently wrong.
- **Every fence names the pyramid ROW as well as `claimSeq`.** The sequence
  counts from zero per row and clearing an actor's heatmaps deletes the row, so
  token 1 before a clear and token 1 after it are different builds — the
  likeliest collision there is. This applies to the claim, the tile flush, the
  progress/status write and the completion sweep alike — the sweep especially,
  since it is the write that DELETES: unfenced, a build sweeping at version 2
  whose call landed after a clear deleted the replacement build's version-1
  tiles, and that build then stamped itself `completed` over tiles that were
  gone.
- **Tile work never fails the run.** Every map now renders the pyramid, but only
  after its first batch of tiles resolves — until then, and whenever a fetch
  fails, it draws the untiled blob. So losing a build costs zoom detail while
  failing the run costs the user the heatmap they can actually see. Every tile-path error — the tiler, a flush, the
  completion — abandons the build, records why on the pyramid row, and lets the
  legacy path finish. Two writes have nothing to record on and are only logged:
  the CLAIM, because its compare-and-swap and the read confirming it share one
  transaction, so it either happens and is reported or does not happen; and the
  completion SWEEP, which runs after the build is already `completed`, so its
  failure leaves stale tiles for the next build's sweep and nothing else. The
  claim's exception is a transaction that commits and loses its
  acknowledgement, where the row is claimed and the caller never learns it: that
  build waits out the staleness window like any other whose worker died. The
  same shape applies to the completion write, whose caller treats a lost
  response as a failure and releases a build that is in fact finished; both are
  what an at-least-once queue and a non-idempotent write cost, not something a
  guard here removes.
- **A build this pass was CARRYING rather than holding is released from one
  place, the handler's `finally`.** Four separate guards drop a continuation,
  and a per-guard release was missed on one of them twice; no per-guard release
  covers a throw between reading the token and making the claim either. The
  release is unconditional because it is fenced on the carried token and every
  claim moves the token: once this pass adopted the build, or anyone else took
  it over, it matches nothing. (A build the pass went on to CLAIM is a different
  thing, and is released at each of the exits that can abandon one.) A dropped
  continuation is the case that matters most — it holds the only copy of its
  build's token, so walking away strands the build AND refuses the Generate that
  displaced it, for the whole staleness window.
- **A build only completes over a history it actually scanned, counted again at
  the moment of the decision.** It catches an activity ADDED during the build,
  where the recount rises above what the scan reached — but only while that rise
  survives to the decision: the recount runs AFTER the scan, so a deletion
  landing between the final page read and it cancels the shortfall exactly, and
  the build completes having re-presented a file. That window is why the fold's
  `foldedThisFile` guard is not redundant with this check. It does NOT catch an
  activity DELETED from the already-scanned part either: that shift skips a file
  AND lowers the recount by the same one, so the pass looks exactly as covered
  as it would have been, and the build completes missing an activity until the
  next full generate. `completedAt` is what makes the next claim
  answer `already-fresh`, so certifying a scan that fell short does not merely
  lose tiles — it refuses the regenerate that would have picked them up, turning
  a transient hole permanent. An activity uploaded while the build runs sorts
  first and lands before the offset a continuation resumes at, so it is never
  presented to the fold gate at all; the pass hands the build back rather than
  stamping it. The count comes from a fresh `countFitnessFilesByActor`, because
  the snapshot taken before the scan is blind to exactly the upload in question.
- **A build that could not READ every file it walked past still completes, and
  says so on the row.** The cursor advances for a file whose download or parse
  threw — it must, or the build is unresumable — so "reached the end" and "read
  what it reached" are different facts, and the second one is a degradation the
  row records in `error` rather than a reason to withhold the build. That count
  is carried across continuations with the build's token, because the pass that
  finishes a long history is rarely the one that hit the outage and a per-pass
  count reads `error: null` over a build that lost activities. Refusing to
  complete would wedge any actor with one permanently unreadable object, which
  the legacy blob simply skips.
  Withholding the SWEEP does not protect the missing geometry, which was tried
  first and reverted: tiles are one row per `(actorId, tileKey)` and
  `mergeTileDelta` REPLACES a tile whose stored version is older, so a readable
  activity destroys an unreadable one's contribution to every tile they share —
  measured, a partial outage kept 66 of 224 tiles and still lost 37% of the
  points, while a permanently unreadable file blocked the sweep forever so
  deleted activities never left the pyramid.
- **Completing a build and sweeping the previous one's tiles are separate
  steps.** The sweep runs after the guarded completion write has already stamped
  the row, and the release that a completion failure triggers is fenced on a
  token completion does not move — so a sweep inside the same `try` rewrote a
  finished, correct pyramid to `failed` over the very tiles it had just
  certified. A failed sweep costs some tiles at an older version, which the next
  build's own sweep removes.
- **Tiles are stored UNCLIPPED and a region is applied when they are served.**
  The pyramid is per-ACTOR and covers every activity over all time, so whichever
  region row wins the claim builds the same tiles — which is also why only the
  all-activities/all-time heatmap gets a `tileSource`. A row filtered to one
  sport or one year is not something the pyramid can answer however complete it
  is, and `isPyramidVariantHeatmap` is the single place that decides it (it
  mirrors `isPyramidVariant` in the job, which decides whether a run builds
  tiles at all).
- **The public token route refuses any share the pyramid cannot answer, using
  the SAME predicate that decides whether a heatmap advertises a `tileSource`.**
  A share scoped to one sport or one year is not something a per-actor,
  all-time pyramid can answer, and serving it from there publishes every sport
  and every year — a leak that region clipping cannot catch, because such a
  share is usually world-wide. Deriving the route's go/no-go from
  `buildHeatmapTileSource` rather than re-deriving the conditions is what stops
  the serving path and the advertising path drifting apart, which is exactly
  how the gate came to be on the pages and missing on the route. The predicate
  therefore tests `activityType` for null rather than for falsiness: the job's
  own gate is `activityType === null`, and reading an empty string as "no
  filter" here while the job read it as a filter matching nothing would serve a
  whole history behind a row showing none of it.
  The OWNER route has no such gate and needs none: its request names a region
  and nothing else, so there is no variant to disagree with.
- **On the public token route, clipping to the SHARED ROW's region is the
  security boundary — not a view option.** The caller sends tile indices and
  nothing else; the region comes from the row the token resolved to. Without
  that, a share cut to one rectangle is a lookup oracle for the actor's whole
  history. Out-of-region tiles are settled from their coordinates BEFORE any
  read, boundary tiles are clipped vertex by vertex through the untiled
  heatmap's own `splitSegmentByBounds`, and the classification is allowed to be
  pessimistic (a union covering a tile reads `partial` and clips to the same
  geometry) but never optimistic.
- **The region resolver FAILS CLOSED.** `getRegionBounds` answers `[]` both for
  the whole world and for a region string it could not parse a rectangle out of,
  and `[]` means "clip nothing" everywhere downstream — so a rect share whose
  stored token failed to parse would serve the world. Only the empty string, the
  world sentinel `serializeRegions` emits, reaches the unclipped path; anything
  else that resolves to no bounds is refused — a case a writer really could
  produce, since `serializeRegions` used to emit a rectangle that rounding had
  collapsed, and rows written then still hold one. **All four PUBLIC surfaces
  apply that rule**, through the one `resolveSharedHeatmapRegionBounds`: for
  such a row the generation job baked the whole world into the untiled
  `segments` too, so the share page, the embed page and the embed image refuse
  it exactly as the embed tile route does. The OWNER tile route is deliberately
  not among them — it clips to the region its own authenticated caller sent.
  Over-refusing now costs the whole share, not just its zoom detail. Anything that PRODUCES a rectangle gates on
  `isSerializableRect`, the same predicate `serializeRegions` applies, so a
  producer and the serializer cannot drift — a box thinner than the 0.01°
  serialization step is well formed and still has no canonical key of its own,
  and saving one takes the WORLD's key. It runs before the conditional-request
  check, so no response — 200 or 304 — is produced without it. The three
  route-heatmap surfaces that take a region from a client normalize it with the
  one shared `normalizeRegionParam`; the region-names route keeps its own
  variant, which answers null rather than `''` for the world sentinel because a
  world scope is not a nameable region.
- **The public tile route reads the share row WITHOUT its geometry**
  (`getFitnessRouteHeatmapSummaryByShareToken`). It answers from the pyramid
  and needs the row only for its actor, status, scope and variant, while
  `segments` holds the entire untiled heatmap — which a panning viewport would
  otherwise drag off disk and through `JSON.parse` once per tile batch, and
  before the conditional-request short-circuit at that.
- **The public route re-encodes every byte it returns.** The owner path may
  forward a stored payload verbatim for a tile that needed neither clipping nor
  stripping; the public one always goes through `decodeTile` (which validates
  ranges) and back out through `encodeTile`. `flattenTilePrivacyForPublic` lives
  beside `flattenPrivacySegmentsForPublic` so both public surfaces answer to one
  doctrine — the privacy FLAG goes, the geometry stays.
- **Only a `completed` pyramid serves tiles, and only at its own `version`.** A
  build in flight has two versions in the table at once, and drawing them
  together shows heat no build ever produced. The version filter is not
  belt-and-braces: completion's stale sweep runs in its own `try/catch`, so a
  build that completes after the sweep throws leaves exactly those leftovers.
  The response reports the version it actually served (0 for none) and its keys
  are the ones the REQUEST named, never the ones the read returned.
- **Every read of the pyramid from a surface that is not about tiles is
  best-effort.** The owner's heatmap GET and both public pages read it only to
  publish a `tileSource`, so each wraps the call in `.catch(() => null)`:
  letting it throw would trade the whole untiled response — the map the user can
  actually see — for a table nothing renders yet, which is the trade the rule
  above exists to forbid.
- **The `v` request parameter is a cache-buster, never a tile filter.** A
  well-formed version that has since moved is answered with the current tiles
  and the current version; refusing it would blank a map the instant a rebuild
  finished underneath a client still holding the previous `tileSource`. A
  MALFORMED one is a 400 on both routes — a client that thinks it is busting a
  cache with a value the server cannot read should be told, not quietly served
  from the entry it meant to bypass.
- **Both tile routes parse their query through one `parseTileBatchQuery`.** Two
  parsers had already drifted: `?z=4&z=16` resolved to 16 through
  `Object.fromEntries` and to 4 through `searchParams.get`, and a malformed `v`
  was a 400 on one route and ignored on the other. Neither was a leak, but a
  divergence between two routes that must agree is how one becomes a leak the
  next time either grows a scope-bearing parameter.
- **The client picks its rung by rounding UP, and two unit conversions guard
  that.** GL reports zoom on a 512px tile grid while the pyramid is built on
  256px tiles, so `map.getZoom() + 1` is the pyramid's zoom; MapKit has no zoom
  at all and derives a FRACTIONAL one from its region and element width, never
  `getZoomLevelForBounds`, which returns the floor and would undo the rounding.
  A view needing more than `MAX_TILES_PER_VIEW` is COARSENED down the ladder,
  not refused; the ceiling is sized ABOVE what real viewports ask for (273 tiles
  at 1280x720, 558 at 1920x1080, 984 at 2560x1440) because coarsening costs a
  whole rung of detail. The tile cache must hold more than one view or a view
  evicts its own fetched batches — and it is bounded by VERTICES as well as tile
  count, since a decoded vertex is a ~82-byte object and the format has no
  per-tile point ceiling. Eviction never touches the current view's tiles.
- **Tiles REPLACE the untiled geometry, never draw beside it.** The two describe
  the same roads at different fidelities, so together every line renders at
  twice its opacity. The swap waits for a batch to resolve, so a pan never
  blanks the map, and a failed fetch leaves the previous view standing.
- **The STATIC share image reads the pyramid too, and enforces the same two
  boundaries the tile routes do.** `buildHeatmapSegmentsFromTiles` takes the
  heatmap ROW, not a bare actor id — pairing a scope with the wrong actor's
  history is the mistake the signature exists to prevent — gates on
  `buildHeatmapTileSource` BEFORE the read, and clips every tile to the shared
  row's region. Clipping cannot substitute for the variant gate: it bounds
  geography and nothing else, so a share scoped to one sport or one year drawn
  from the whole-history pyramid publishes every sport and every year. The rung
  comes from the IMAGE's own size along whichever axis the renderer fits by
  (`min(width / spanX, height / spanY)`, in projected units — a degree of
  latitude is not a fixed number of pixels in Mercator), and geometry is placed
  with each ROW's own `z`/`x`/`y`, never the rung the view computed.
- **Each static renderer is offered the tiles FIRST and the stored blob SECOND,
  and the blob is why the dual-write still exists.** Tile geometry is one run
  per way per tile where the blob is roughly one polyline per activity, so a
  street-level view is hundreds of overlays rather than tens — a shape neither
  basemap renderer can draw. Apple refuses outright past
  `MAX_SNAPSHOT_OVERLAYS` (24), which dropped those instances to the keyless SVG
  and cost them their basemap; Mapbox silently truncates at
  `MAPBOX_STATIC_URL_BUDGET` (7000 chars) and then frames the image with
  `/auto/` on only the overlays that survived, which — since tile runs arrive in
  tile order — is one contiguous corner of the view blown up to fill the frame.
  `requireAllOverlays` makes the tiled candidate refuse rather than truncate. Do
  NOT remove the fallback, and do NOT make pyramid rows store `segments = null`,
  until the raster path can stand alone (coarsening down the ladder until the
  geometry fits a renderer's ceiling is the open design). Only the keyless SVG
  renderer has neither limit — and it is the only one that shades strokes by
  visit count; Apple and Mapbox draw every stroke at a flat 0.9.
- **The share page's link-preview card points at that same image route, and
  `format=png` is what makes it work.** `/u/heatmaps/<token>` publishes
  OpenGraph and Twitter tags through `generateMetadata`; its `og:image` is the
  existing `/embed/heatmap/<token>/image`, deliberately NOT a fifth public
  surface, so the share guards that route already enforces are the ones that
  apply. That route answers SVG whenever it falls through to the keyless
  renderer — which is what every instance without a Mapbox token or Apple key
  serves, llun.social included — and no card crawler (X, Facebook, Mastodon,
  Slack, Discord) renders SVG, so the raster parameter is load-bearing rather
  than a nicety. It is opt-in because the SVG scales and the embed snippet the
  share dialog hands out already points at that URL, and anything but the exact
  string `png` collapses onto the default, so the parameter cannot widen the
  cache variants `DIMENSION_STEP` exists to bound. Both callers build that URL
  through the one `buildHeatmapEmbedImageUrl` — the share dialog in the browser
  and the card on the server — so the route's query shape has a single owner. A rasterization failure
  degrades to the SVG rather than 500ing, on the same reasoning every other
  tile-path failure follows. The declared `1200x600` is what the route will
  actually serve — 630 snaps to 600, and only the Apple path differs (1280x640,
  same ratio).
- **The card's facts come from the SAME view the page renders, and a share that
  will not render gets NO card.** One `cache()`-memoized `loadSharedHeatmap`
  feeds both `generateMetadata` and the page body, so a card cannot describe a
  share the page refuses — the alternative is a second lookup path free to
  drift from the first. A revoked token, a share re-queued for generation and
  an unresolvable region all 404, and each returns the bare metadata: an
  `og:title` for one publishes the region name, the owner's handle and a
  thumbnail that the refusal exists to withhold. The page stays `noindex`
  because the token is the secret, which costs the card nothing — crawlers read
  OpenGraph without consulting robots, this instance's own
  `parseOpenGraph` included.
- Full design and rationale: `docs/fitness-file-storage.md` → Route heatmap tile
  pyramid.

<a id="agents-fitness-gear"></a>

### Fitness Gear

- **A gear total is derived, never stored.** `fitness_gears` and
  `fitness_gear_components` carry no distance column: a gear's lifetime distance
  is `SUM(fitness_files.totalDistanceMeters) WHERE gearId = ?`, and a
  component's is the same sum restricted to activities whose `activityStartTime`
  falls in one of its install periods (see below). Do not add a cached total
  "for performance" — it would have to be reconciled on every back-dated upload,
  archive re-import, edit and delete, and the whole point of the model is that
  totals always agree with the calendar.
- **A component's install history is a LIST of periods, not one window.**
  `fitness_gear_component_periods` holds a row per stretch the part was fitted
  (`installSequence`, `addedAt`, `removedAt`), and `fitness_gear_components` has
  no `addedAt`/`removedAt` columns at all. The component's own `addedAt` and
  `removedAt` are DERIVED — the first period's start and the LAST period's end —
  so they still mean what they always did ("when it first went on", "when it
  last came off", null while fitted) and every existing reader is unaffected,
  including `evaluateGearServiceReminders`' "is it fitted now" and
  `diffGearComponents`' `(type, brand, model, addedAt)` identity. One window
  could not describe a part that comes off and goes back on: clearing
  `removedAt` reopened the ORIGINAL window, so a part unretired months later was
  credited every activity ridden while it sat off the bike, and re-retiring did
  not take that back — it only closed the window again at the new today. Do not
  reintroduce the columns as a denormalised copy of the latest period, for the
  reason the totals are derived: a second source of truth for the same fact
  drifts and nothing downstream can tell.
- **Retiring closes the open period; refitting opens the NEXT one at today.**
  `POST /api/v1/fitness/gear/:id/components/:componentId/refit` is its own
  endpoint precisely because it is NOT the mirror of `/retire` — reopening the
  closed period is the retroactive credit above. A new period costs at most the
  gap between the retirement and the refit: seconds for a misclick (so the
  card's one-click, unarmed Refit still reads as an undo), and the truth for a
  wheelset that really did spend a winter on the shelf. `PATCH { removedAt:
null }` remains the precise "this retirement never happened" — it reopens the
  LAST period — and PATCH's `addedAt`/`removedAt` reach only the outermost
  bounds (first period's start, last period's end), which is what keeps an edit
  from making two periods OVERLAP. It does not on its own keep a period from
  being INVERTED, and the route has to check each bound against the other end
  of the period it lands on to do that: the component's own `addedAt` and
  `removedAt` are derived from two DIFFERENT periods once a part has been
  refitted, so validating the request against that derived pair compares bounds
  that do not belong together and lets `[May 1, Feb 15)` through — a period no
  activity can fall inside, which drops its distance silently and for good. The
  bug reads as correct because for a single-period component the first and last
  period are the same row and the two formulations coincide.
  **The route's check is not sufficient on its own, and the write guards its
  own ordering too.** The route validates the periods it READ;
  `updateFitnessGearComponent` resolves which period is first or last when it
  WRITES, and a refit landing between the two appends one — so a bound lands on
  a row the check never saw. Once a further refit buries that period in the
  middle, nothing re-examines it, because only the first and last are ever
  checked. How the write guards it depends on where the bounds land, and the
  split is the whole subtlety: when they land on DIFFERENT rows each carries an
  SQL predicate against the other end that row keeps, but when they land on the
  SAME row — one period, which is every component never refitted — they are
  written together and the ordering is settled in JS. Per-bound predicates
  there would compare the new `addedAt` against the OLD `removedAt` the same
  statement is about to replace, so a wholesale window move applied one half
  and silently dropped the other behind a 200.
- **Periods must never overlap, and `UNIQUE (componentId, installSequence)` is
  what enforces it against a race.** The rollup joins the periods and sums over
  them, so an activity inside two of them is counted twice — a permanently wrong
  number nothing downstream can detect. Two concurrent refits both read the
  highest sequence and both try to claim the next one; the unique index lets
  exactly one win, and the loser reports "already fitted". The loser identifies
  itself from the ERROR, through the shared `isUniqueConstraintError` — never by
  re-reading the component and suppressing when it happens to look fitted, which
  cannot tell that transaction's unique violation from a dropped connection or a
  bug in either write, and would report a real fault as a tidy 404. Do
  **not** replace it with the partial `(componentId) WHERE removedAt IS NULL`
  that expresses "at most one open period" directly: knex emits a partial
  index's predicate on PostgreSQL and SQLite but DROPS it on MySQL-compatible
  clients (see `20260820000000_add_local_public_timeline_indexes.js`), leaving a
  bare `UNIQUE(componentId)` that forbids a second period outright.
- **`installSequence`, not `addedAt`, is the ordering key.** The first period's
  `addedAt` is nullable ("since the gear's beginning") and the backends disagree
  on where NULLs sort — the same reason `getFitnessGearComponents` splits its own
  list in JS rather than in SQL.
- **Both rollups reuse the stats predicate**
  (`deletedAt IS NULL` + `processingStatus = 'completed'` + `isPrimary`) that
  `getFitnessActivitySummary` uses, so gear numbers line up with the fitness
  overview. A new rollup that filters differently will quietly disagree with
  every other surface. Two deliberate asymmetries: the summary additionally
  requires a non-null `activityType`/`activityStartTime` because it groups by
  them, so a timestamp-less GPX counts toward a gear total and is invisible
  there; and an activity with no `activityStartTime` counts only for a
  component with a period open on that side, since it cannot be placed inside
  `[addedAt, removedAt)`. A gear total may therefore exceed the sum of its
  components.
- **Below 480px the components table snaps one data column per swipe** —
  `useGearTableColumns` (`@/app/(timeline)/fitness/gear/useGearTableColumns`),
  which is the design system's `useGKSnapCols`. It layers on top of the pinned
  first column described above, and only the components table uses it so far:
  the gear list's bikes/shoes/devices tables pin but do not snap, and still
  carry a `min-w-[520px]`. That is a **known gap against the design**, not a
  decision — `GearKit.jsx` runs all four tables through `useGKSnapCols` (150px
  for the three gear tables, 104px for the components one), so on a phone the
  gear list scrolls as one block where the design snaps it, which is the same
  failure `min-w-[720px]` used to cause on the components table. Under the
  threshold each data
  column is sized to the width the pinned column leaves over — floored at 184px
  so the distance cell's wear line still fits, but that floor may only overhang
  the scrollport by the cell's own 12px of right padding, because the column's
  content is right-aligned and `x mandatory` means nothing that hangs off can be
  scrolled to (at a 320px viewport the floor was hiding 6px of the distance) —
  with `scroll-snap-type: x mandatory` and a `scroll-padding-left` clear of the pin,
  so a swipe lands on one whole column instead of stranding a row's values
  halfway across the viewport. The rule measures the table's **own scroll
  container** with a `ResizeObserver`, not the viewport, for the same reason
  `useCompactActionBar` and `FitnessStatGrid` do: a gear table can sit in a
  narrow column on a wide window. It attaches through a **callback** ref, not a
  ref object: the table is conditional (an empty bike renders the empty state
  instead), and a ref object assigned later re-runs no effect, so the observer
  would never reach the table that appears when the first component is added.
- **Do not put `min-w-[720px]` back on the components table.** The per-cell
  minimums already add up to about that, so the class only ever forced the wide
  layout onto phones, where the type column had scrolled away by the third
  column. Note what the threshold does and does not promise, though: between
  480px and ~740px (the seven minimums: 120 + 96 + 132 + 108 + 112 + 88 + 84,
  which moved with the pin when it went to 120px) the table still scrolls as one
  block, exactly as before — the
  difference is that the type column is pinned through it, which is the half
  that was broken. Only below 480px does a swipe move one column.
- **Every cell in the components table carries `wrap-anywhere`.** A `<td>`'s
  width is advisory, and the component type, brand and model are all free text
  to 255 characters (`gearRequests.ts`) — a long unbroken value widens its
  column past the snap interval, and under `x mandatory` a column wider than its
  interval has a tail the scroller can never rest on. `break-words` is **not** a
  substitute: `overflow-wrap: break-word` does not reduce a box's min-content
  contribution, only `anywhere` does, and the difference is invisible in
  Chromium (which honours the explicit width anyway) while breaking elsewhere.
- **Evaluate service reminders only after the activity is `completed`.** The
  rollups count completed activities, so a reminder computed while the file is
  still `processing` reads the total from before the ride that caused the
  crossing — the notification then arrives one activity late, or never if that
  was the last ride on that gear.
- **Batch, don't loop.** `getFitnessGearDistanceRollups` and
  `getFitnessGearComponentDistanceRollups` each answer a whole page in one
  grouped query; the component one puts the install window in the JOIN condition
  (not the WHERE clause) so a component with no matching activity still returns
  a row and counts 0. The window compares `activityStartTime` column-to-column
  against the bounds, which is safe because knex writes all three in the same
  representation per backend — never add raw date arithmetic there without an
  `isSQLiteClient` branch. The component query additionally joins
  `fitness_gear_component_periods` and carries `p.id IS NOT NULL` in the file
  join: a component with no period row is a shape nothing creates, but without
  that clause BOTH window tests read as TRUE against the missing row's NULLs and
  the component claims every activity on the gear
  (`fitnessGearComponentPeriods.test.ts`).
- **`fitness_files.gearId` has no database-level foreign key**, because adding
  one via `alterTable` needs a table rebuild on SQLite. Ownership is enforced in
  `lib/database/sql/fitnessGear.ts`, and `deleteFitnessGear` nulls the column in
  the same transaction that soft-deletes the gear.
- **Match sports through `normalizeActivityTypeToSportKey`**
  (`@/lib/services/fitness-files/sportTypes`), never against the raw
  `activityType`. Gear stores canonical keys; the normalizer maps the dialects
  onto them and returns null rather than guessing, so an unrecognised type
  simply does not auto-assign. Prefer null over a plausible guess: a wrong
  mapping silently attributes activities to the wrong bike.
- **`fitness_files.activityType` is WRITTEN as a canonical activity type**, via
  `normalizeStoredActivityType` in `toActivityData` — the one function all three
  parsers return through, so it covers uploads and the Strava webhook alike (the
  webhook writes its `sport_type` into a generated TCX and parses it back). Four
  vocabularies still arrive at that funnel (FIT `cycling`, TCX `Biking`, Strava
  `GravelRide`, free-form GPX), and rows imported before this rule keep whichever
  one they came in with until `scripts/fitness/normalizeFitnessActivityTypes.ts`
  sweeps them — which is why matching still goes through the normalizer rather
  than comparing strings. Normalized stored types cover the 9 gear sport keys plus
  canonical non-gear activities (`swim`, `training`, `rowing`, `yoga`, `climbing`,
  `ski`, `skating`, `surfing`, `racket_sports`, `martial_arts`, `team_sports`, `golf`,
  and defaulting anything else to `other`). Missing or whitespace-only values normalize to null.
- **Naming a sport for a post caption is `getActivityPresentation`**
  (`@/lib/services/fitness-files/activityPresentation`) — the import job and the
  Strava summary builder both go through it, and nothing else should grow its
  own table. Matching substrings on a raw `sport_type` is exactly what captioned
  a `MountainBikeRide` with the road-bike glyph. It deliberately keeps **gerund**
  labels ("Cycling", "Gravel cycling") separate from `SPORT_LABELS`' UI nouns
  ("Ride", "Gravel ride"): caption text is federated and stored forever, so
  rewording it changes published posts.
- **Caption from the RAW sport, not the stored key** —
  `FitnessActivityData.rawActivityType` carries the source file's own spelling
  beside the canonical `activityType`, and `buildActivitySummary` prefers it.
  The key answers "which bike or which shoes", so it folds `Handcycle` and
  `Velomobile` into `ride` and `VirtualRun` into `run`; a caption is not
  answering that, and "Cycling" erases a distinction the athlete made. Those
  three have their own entries in `SPECIFIC_ACTIVITY_LABELS`, checked **before**
  the sport-key lookup because they do resolve to a key and would never reach
  the unmodelled table. Reading the stored key here made a directly uploaded
  handcycle ride disagree with the same ride imported from Strava, which
  captions from its own raw `sport_type` — guarded end to end in
  `processFitnessFileJob.test.ts`, since a unit test on the presenter alone
  cannot catch a caller handing it the wrong value.
- **A sport belongs to at most one of an actor's gears**, retired ones included
  — scoping the invariant to active gear only would let unretiring produce two
  holders and make auto-assign arbitrary. Claiming a sport takes it off whoever
  had it, inside the create/update transaction. It is enforced by that
  read-then-write rather than by a constraint (`defaultSports` is a JSON text
  column), so two genuinely concurrent creates can both end up holding a sport;
  auto-assign stays deterministic regardless, because
  `findFitnessGearByDefaultSport` resolves oldest-first.
- **Retiring is not deleting and not un-assignable.** Retired gear is out of the
  pickers and out of auto-assign, but stays explicitly assignable so old
  activities can still be attributed to a bike that has since been sold.
- **The activity page carries gear inline in the header's metadata line** —
  `date · visibility · gear`, the way `FAGearRow` does in the design system's
  `ui_kits/web/FitnessActivity.jsx`, not as a labelled field with a row of its
  own — and that line **reports**, it does not edit. The gear is a LINK to its
  gear page for the owner, plain text with the kind's icon for everyone else
  (`/fitness/gear/<id>` is owner-scoped, so a link offered to a viewer would only
  ever 404 — the same constraint `BrandedDeviceLink` resolves the same way on the
  line below it), and nothing at all when no gear is attributed. The lifetime
  distance rides in the link's `title` rather than on the line, which is already
  carrying the date and the visibility.
- **Changing the assignment is "Change gear" in the post's own ⋯ menu**, as
  `FAMoreMenu` has it — a submenu listing each candidate with its lifetime
  distance (what tells two similar bikes apart at a glance) plus a "No gear" row
  that clears it. It reaches the shared `PostMenu` through `Actions`'
  `extraMenuItems`, which can only **add** to the action set (see **Status Posts
  & Actions**), and it is absent entirely for an owner with nothing to pick — a
  submenu whose only entry is "No gear" is dead UI, the same rule that keeps the
  metadata line clear. The submenu trigger is disabled along with its rows while
  the PATCH is in flight, because two quick changes otherwise race and the
  loser's rollback restores a value the server has already replaced; a menu of
  choices none of which respond is worse than one that will not open. A failure
  reports on the metadata line beside the gear it was for, not in the menu,
  which closes itself on select. Whatever is assigned is always in the list even
  when the kind filter or its retirement would drop it: a picker that cannot
  represent its own value renders the assignment as something else, which reads
  as the gear having changed on its own. In a post's inline chip, gear instead
  rides along with the distance cell ("42.6 km · Moots") rather than taking a
  cell of its own.
- **Nothing is imported from Strava's own gear, and no import ever creates a
  gear row.** Neither the webhook path (`activity.gear_id` plus
  `GET /gear/{id}`) nor the archive path (the `Activity Gear` column and
  `bikes.csv`/`shoes.csv`) reads gear from Strava any more, and the
  `stravaGearId` column is gone with them. The reason is `kind`: it was guessed
  from an undocumented `b`/`g` id prefix or from an optional CSV, it is
  immutable by design, and a bike filed as shoes shows no components card,
  refuses a frame type, and offers shoe advice in its reminder — repairable
  only by deleting the gear and detaching every activity on it. So the shed is
  the athlete's alone: an imported activity is attributed exactly like an
  uploaded one, by `processFitnessFileJob` from the gear whose `defaultSports`
  claims the parsed sport. Do not reintroduce a "create the gear we saw" path
  in any importer.
- **The default-sport mapping has a second editor, on the Strava settings
  page** (`StravaGearDefaultsSection`), listing it the other way round —
  activity type → gear — because that is the question someone connecting an
  import source is asking. It is a view over `fitness_gears.defaultSports`,
  **not** a table of its own: pointing a sport at a gear is one PATCH of that
  gear, and the database's own steal takes the sport off whoever held it. That
  is also why the editor re-reads the whole list after every write — the
  response carries only the gear that was written, never the one it was taken
  from.
- **Import jobs assign with `assignFitnessFileGearIfUnset`**, whose
  `whereNull('gearId')` guard is the correctness guarantee rather than an
  optimisation: those jobs re-run, and a manual assignment made between a read
  and the write must survive. Only the owner's own PATCH uses
  `setFitnessFileGear`, which overwrites.
- **Service reminders are evaluated on write, not on a schedule** — this
  instance has no recurring job infrastructure (the queue can delay a message
  but not repeat one). `evaluateGearServiceReminders` runs where a total can
  change and records the distance it fired at in `lastAlertedDistanceMeters`, so
  each crossing notifies once and a raised threshold re-arms on its own.
- **Orange TEXT uses `text-primary-text`, not `text-primary`.** `--primary`
  (`hsl(24 95% 46%)`) is the brand orange for icons, fills and accents; as a
  foreground it is only 3.37:1 on the card, so link text set in it fails WCAG 2.1
  AA (SC 1.4.3) at body sizes. `--primary-text` is the same hue tuned per theme
  until it clears 4.5:1 on every surface such a link sits on — including the
  `--muted` row-hover, which is stricter than the card — darker in light mode
  (37%) and _lighter_ in dark (55%), because on the dark ramp contrast comes from
  going up. This is the split the design system makes itself (`GK_ORANGE` vs
  `GK_ORANGE_TEXT`). It backs the gear list's retired toggle, the gear
  product-page link, and the components card's retired toggle and per-row
  Retire action;
  `app/globals.contrast.test.ts` recomputes both ratios from the live token
  values, so collapsing the two tokens back together fails the suite. Other
  orange text in the app still predates this and should move over when touched.
- **Every gear table pins its first column, through the shared constants in
  `app/(timeline)/fitness/gear/gearUi.ts`** — `STICKY_COLUMN` and
  `STICKY_CLICKABLE_COLUMN`, used by the gear list's bikes/shoes/devices tables
  and by the components table on a gear's page. The design system's
  `ui_kits/web/GearKit.jsx` builds these tables from a pinned first column with a
  hairline down its right edge, and that hairline is the table's structure — it
  is the table's only vertical rule, and it is what separates each row's subject
  from its numbers. Rendered as plain columns with no rule, the rows read as
  loose text, which is what these tables looked like before. Four details are
  load-bearing. **The pinned column's surface is `bg-card` — the same grey as
  the card behind it — not `bg-background`.** This is the design's own
  relationship, verified against the kit: `useGKSnapCols` pins the cell with
  `background: 'white'` and every card holding one of these tables is
  `bg-white/80`, so the lane is painted the **card's** colour and the hairline is
  the only thing separating it. That literal white is there to make the sticky
  cell opaque, not to step the column off anything — there is no recessed lane
  anywhere in the kit. `bg-background` copied the colour rather than the
  relationship and broke it in **both** themes: the kit is a static prototype
  that hardcodes white instead of reading `--card`, while its `app/globals.css`
  carries the same tokens this app has (light `--background` 100% / `--card` 98%,
  dark 3.9% / 9%), so against a `bg-card` table it came out a bright white stripe
  in light mode — a third of the table's width on a phone — and a well sunk below
  the card in dark. Whatever the colour, it must be **opaque**, or the data
  columns
  scroll straight through the pinned cell. The divider is an inset shadow, not a
  `border-r`, because `border-collapse: collapse` (Tailwind's preflight default)
  hands border painting to the table and drops a sticky cell's own right border.
  A dimmed row (retired gear, a retired component) dims its **cells**, never the
  `<tr>` and never the pinned `<td>` itself — `opacity` fades an element's
  background along with its text, so either one takes the pinned column's surface
  down with it. And the hover colour is the OPAQUE `bg-muted` on both the row and
  its pinned cell, never `bg-muted/50`: a translucent hover replaces the cell's
  own surface rather than layering over it, so the cell would turn 50%
  transparent exactly while the pointer is on the row. Rows separate with
  `border-t`, so the header carries no rule of its own and the last row no
  trailing one. The pinned width is not part of the constants — the design pins
  the gear and device tables at 150px and the denser components table at 104px,
  and the components table takes **120px** rather than that 104px because our
  pinned cell is `px-4` where the design runs a flat `px-3`: at 104px the content
  box was 72px and "Handlebar" (72.6px at `text-sm font-medium`) broke mid-word,
  which is what `wrap-anywhere` does to a word that does not fit. 120px leaves
  88px, clear of "Chainrings" at 74.7px, the widest single word in
  `COMPONENT_TYPE_OPTIONS`; multi-word values still wrap at their spaces, and
  fitting "Front brake pads" on one line would take a 149px pin, 38% of a 390px
  phone. Widen the width, never drop the wrap —
  and `STICKY_CLICKABLE_COLUMN` belongs only on a row that has its own `hover:`
  and the `group` class — a row carrying `group` without a `hover:` lights the
  first column alone, and a row with neither never matches the variant at all.
- **A gear's activities are the POSTS they were published as, rendered through
  the shared `Posts` feed.** `GearActivitiesFeed`
  (`app/(timeline)/fitness/gear/[id]/GearActivitiesFeed.tsx`) is the single
  implementation, used by a bike's Activities view and by the whole of a
  device's page, so the same ride reads identically on either — same body, same
  stat chip, same action row as in the timeline. It is not a bespoke list: a
  fitness activity is a status, and **Status Posts & Actions** applies to it
  like every other surface. Two consequences are load-bearing. The feed pages
  over ACTIVITY ROWS and the endpoint answers `nextOffset` from those rows, not
  from the statuses in the page: deleting a status only nulls
  `fitness_files.statusId`, so a row with no post left still occupies an offset
  (and still counts toward the gear's totals), and paging from
  `statuses.length` would re-request everything in between forever. And because
  such a row yields nothing to render, the **Activities tile and the feed may
  legitimately disagree** — the tile counts activities, the feed shows the ones
  still posted. A page that comes back entirely postless is walked past rather
  than handed to the reader as a "Load more" that adds nothing — by the INITIAL
  load as much as by "Load more", both of which go through the same walk,
  because a first page empty for that reason would otherwise render "no
  activities" above an enabled button that disproves it — capped the way the
  bookmarks timeline caps its own continuations. The empty state is therefore
  gated on `!hasMore` rather than on an empty list: the walk makes that state
  rare and `onPostDeleted` can produce it at any time regardless.
- **A bike switches between Components and Activities; shoes and devices do
  not.** The switcher is `SectionNavSelect`
  (`@/lib/components/section-nav-select`), the state-driven twin of
  `SectionNavDropdown` — same chrome, but its rows call `onChange` instead of
  navigating, and the current one is marked with the boolean `aria-current`
  because nothing is a page. Only a bike renders a components card, so only a
  bike has a second view to reach: shoes and devices go straight to the feed,
  since a menu with one entry is dead UI (the same rule that keeps the "No
  gear" picker off an empty shed). Do not write a third copy of this dropdown —
  the fitness activity detail's section nav is the other consumer.
- **Every kind carries a product page, and one component renders it.**
  `fitness_gears.productUrl` is the manufacturer's page for a bike, a pair of
  shoes and a head unit alike, edited in the same "Product page" field of
  `GearFormDialog` and rendered by the one `GearProductLink`
  (`app/(timeline)/fitness/gear/`) everywhere it appears — every gear page and
  the gear list's device table alike. Hostname only ("moots.com", not the whole
  URL), leading `ExternalLink`, `target="_blank"` with
  `rel="noopener noreferrer"`, and an `aria-label` because a bare domain is no
  accessible name. It was device-only and the API 422'd it for anything else;
  that restriction is gone, so do not reintroduce a kind check around it. The
  anchor is gated on `getProductUrlHostname`, never on the string being
  non-empty: it returns null for anything that is not an http(s) URL, which is
  what stops a row written before the API validated the column from rendering a
  `javascript:` href. Two props are what let one component serve every surface:
  `onEdit` makes the empty state the prompt that opens the gear form, and
  without it that state is an em dash (the list has no form to open); `onClick`
  is where a clickable row passes `stopPropagation`, without which the anchor
  opens the vendor's page and the row pushes the gear's route behind it. The
  hostname takes `text-primary-text` — `text-primary` is 3.37:1 on the card and
  fails AA for text. Only a device's is ever pre-filled: `resolveDeviceGear`
  seeds it from the brand map when the import creates the row.
- **A recording device is a third kind, and almost nothing above applies to it.**
  `kind: 'device'` rows have no components, no default sports, no distance
  total, no service reminder and cannot be retired; a device page reports an
  activity count and a first-used date, then its activities.
  The device rollups **replace** `isPrimary` rather than relaxing it, because
  for a device it answers the wrong question: the merge groups files by TIME
  OVERLAP and never looks at the device columns, so which file won says nothing
  about which device recorded it. Two devices on one ride leave two files and
  the non-primary one is the only evidence the second device exists (with
  `isPrimary` it reports 0 activities forever); one device that produced two
  files for one ride — a `.fit` beside a `.gpx`, a manual upload beside the
  Strava sync — also leaves two, and counting both reports one ride twice. The
  rule is therefore per RIDE per DEVICE, not per file: of the countable files
  sharing a `(statusId, deviceGearId)`, exactly one survives — the primary if
  that device owns it, otherwise the lowest id. It is written as "nothing else
  beats me", so it needs no window function and reads the same on both backends.
  It deliberately never defers to a file that is itself uncountable: a merge
  writes the primary `pending` and the secondaries `completed`, so deferring to
  an unfinished (or permanently `failed`) primary would drop the ride from the
  device entirely. The rollup and the activity list apply the identical
  predicate, so the count and the page can only ever differ by an activity whose
  post was deleted — which the rollup still counts and the feed has nothing to
  render for. A head unit records rides and
  runs alike, so one summed distance would be a number with no meaning, and
  claiming a sport would take that sport off the bike or shoes that should hold
  it. `SPORT_KIND` is therefore typed `Record<SportKey, UserCreatableGearKind>`
  and `getSportKeysForKind('device')` answers `[]` with no special case.
- **A device's identity and its display fields are separate on purpose.**
  `fitness_gears.deviceKey` is derived only from what the file recorded
  (`name:<lowercased, whitespace-collapsed deviceName>`, else `mfr:<brand key>`,
  else nothing — and then no row exists), is UNIQUE with `actorId`, and is never
  rewritten. `name`/`brand`/`model`/`productUrl` are the owner's to edit.
  Keying on the name instead would fork a duplicate row the first time someone
  renamed "Garmin Edge 840" to "the Edge", and every later ride would land on
  the new row while the earlier ones stayed on the old.
  `fitness_files.deviceName`/`deviceManufacturer` stay the immutable recorded
  facts; `deviceGearId` is the editable link.
- **`resolveDeviceGear` is the only thing that creates a device**, and it never
  mutates one it finds. It is called by every import path through the shared
  `linkFitnessFileDeviceGear`, which is best-effort throughout: attribution is
  metadata on an activity that has already parsed and stored, so losing it must
  never fail the import. Unlike `assignFitnessFileGearIfUnset`, that write is an
  unconditional overwrite — which bike a ride was on is a judgement the owner
  may correct, while which head unit recorded it is a fact the file states, so
  re-runs converge instead of preserving a stale row. `POST
/api/v1/fitness/gear` rejects `device` with a 422: a hand-made row would carry
  no `deviceKey` and match no upload.
- **Deleting a device releases its `deviceKey` in the same transaction.** The
  `(actorId, deviceKey)` unique index covers soft-deleted rows, so without that
  release the next upload from that device could never create one again — the
  insert would fail against a row nothing can see.
- **`fitness_files.gearId` never points at a device**, and `setFitnessFileGear`
  is where that is enforced rather than in the picker. `gearId` answers "what
  was this ride done on", which a head unit never is, and an activity pointed at
  one falls out of every rollup at once: the device rollups match on
  `deviceGearId` and the distance rollups skip devices entirely, so its distance
  counts toward nothing, `assignFitnessFileGearIfUnset`'s `whereNull` guard
  refuses to auto-assign it ever again, and the status meta line names the head
  unit as the bike.
- **Devices never appear in the activity gear picker**, and the filter that
  excludes them runs BEFORE the kind narrowing in `FitnessStatusDetail`. An
  unrecognised activity type narrows to nothing and offers every active gear, so
  filtering afterwards would put the head unit that recorded the ride in the
  list of things the ride could have been done on. They are excluded from the
  Strava page's default-gear editor for the same reason — and there, also
  because every empty state on it keys on `gears.length`.
- **The device name links to the device page for the OWNER only.**
  `/fitness/gear/<id>` is owner-scoped, so everyone else keeps the branded
  manufacturer link `BrandedDeviceLink` has always rendered — labelled with the
  gear row's name where one exists, since a rename is a rename of the device
  rather than a private note about it. Both render sites (`post.tsx`'s "Via:"
  line and the activity detail's "Recorded with") gate on the gear name OR the
  recorded label, so a device renamed to something the brand map cannot resolve
  does not vanish from the post.
- **A state change is a predicate on the UPDATE, never a decision taken from a
  read in front of it** — that goes for the reminder claim and for the
  retire/unretire toggle alike. Two concurrent requests (two tabs, a retry, any
  API client) would otherwise both read the old state and both write. Where a
  no-op legitimately writes no row, the result comes from a re-read rather than
  the affected-row count, so "already in that state" stays distinguishable from
  "no such gear of yours" — the latter is the route's 404.

<a id="review-apple-maps-basemap"></a>

### Review: Apple Maps basemap

- Every Apple-rendered map draws `mutedStandard`, interactive and static alike:
  the four MapKit components pass `mapType: mutedStandardMapType(mapkit)` to
  `new mapkit.Map(...)`, and the Web Snapshot URL carries `t=mutedStandard`. A
  surface with its own map type, or a re-enabled `showsMapTypeControl`, loses the
  contrast the route lines, heat runs and privacy circles depend on.
- `mutedStandardMapType` falls back to the literal rather than reading straight
  through `mapkit.Map.MapTypes` — that static belongs to the `map` library, not
  `mapkit.core.js`, and every component builds its map inside a `try` that drops
  the whole map to the static/OSM fallback on throw. Don't "simplify" the
  fallback away.
- The snapshot module keeps its own copy of the literal instead of importing the
  component one: `lib/services/**` is server-only and must not reach into the
  client component tree.
- Adding a query parameter to the snapshot URL shifts `MAX_SNAPSHOT_OVERLAYS`,
  which is derived from `buildPath`. Re-check the ceiling rather than assuming it.

<a id="review-fitness-route-heatmap-pyramid"></a>

### Review: Fitness route heatmap pyramid

- An activity is folded into a build **exactly once** — the gate is positional
  (`(createdAt, id)` against the build's own cursor), never a counter, and the
  cursor advances for every file the pass finished with, including one whose
  parse threw.
- Resuming requires the build's **own token** (row id + `claimSeq`), not a
  `resume: true` flag; a pass that can present neither a token nor an offset of
  zero must not claim at all, because the claim itself is destructive.
- Every fence — claim, tile flush, progress/status write, completion sweep —
  names the pyramid **row** as well as `claimSeq`.
- Any tile-path failure abandons the build rather than failing the legacy
  heatmap. A build the pass was CARRYING is released from one place — the
  handler's `finally` — rather than at each of the four exits that drop a
  continuation; a build it went on to CLAIM is released at each exit that can
  abandon one.
- A build only stamps `completed` over a history it actually scanned, recounted
  at the decision: `completedAt` is what makes the next claim answer
  `already-fresh`, so certifying short refuses the rebuild that would heal it.
  The recount runs after the scan, so it catches an addition only while nothing
  cancels the shortfall — which is why the fold keeps its own already-folded
  guard — and it cannot catch a deletion from the scanned part at all.
- Completion and the stale-tile sweep are separate steps: a failing sweep must
  not demote a build that already wrote `completed`.
- A build that could not read every file still completes, and records the loss
  on the row — withholding the sweep does not preserve the missing geometry,
  because a merge replaces any tile a readable activity also touched.
- Tiles are stored unclipped; a region is applied when they are served. Only
  the all-activities/all-time heatmap can be tile-backed.
- The public token route refuses any share the pyramid cannot answer, through
  the same `buildHeatmapTileSource` that decides whether a heatmap advertises
  tiles — a share scoped to one sport or one year would otherwise be served the
  actor's whole history, which region clipping cannot catch. The owner route
  names no variant and needs no such gate.
- On the public token route the region comes from the **shared row**, never from
  the caller, and the resolver **fails closed**: a non-empty region that yields
  no bounds is refused, because no bounds means no clipping. It runs before the
  conditional-request check. Out-of-region tiles are answered before any read.
- **All four PUBLIC surfaces** — the share page, the embed page, the embed image
  and the embed tiles route — refuse through the one
  `resolveSharedHeatmapRegionBounds`, because for such a row the untiled
  geometry was built unclipped too. The OWNER tile route is not one of them: it
  clips to the region its own authenticated caller sent.
- Anything that PRODUCES a rectangle gates on `isSerializableRect`, the same rule
  `serializeRegions` applies. A box thinner than the 0.01° step is well formed
  and has no canonical key of its own; saved, it takes the WORLD's key.
- Both tile routes share one query parser, and read the share row without its
  geometry.
- The public route strips the privacy flag and keeps the geometry
  (`flattenTilePrivacyForPublic`, beside the untiled doctrine), and re-encodes
  every byte it returns rather than forwarding a stored payload.
- Only a `completed` pyramid serves tiles, only at its own `version`, and the
  response's keys are the ones the request named. A well-formed `v` busts caches
  and never filters tiles; a malformed one is a 400 on both routes.
- The static share image is a pyramid reader like the tile routes: it gates on
  `buildHeatmapTileSource` before reading, takes the heatmap row rather than a
  bare actor id, clips each tile to the shared row's region, and places geometry
  with the row's own `z`/`x`/`y`. Its rung comes from the image's own size along
  the axis the renderer fits by.
- A static renderer takes the tiles first and the stored blob second. Apple
  refuses past `MAX_SNAPSHOT_OVERLAYS`; Mapbox truncates at its URL budget and
  then frames on what survived, so the tiled candidate passes
  `requireAllOverlays`. Removing that fallback, or nulling `segments` on pyramid
  rows, costs Apple/Mapbox instances their basemap — reject it unless the raster
  path has been made to stand alone.
- See AGENTS.md → Fitness Route Heatmap Pyramid.
