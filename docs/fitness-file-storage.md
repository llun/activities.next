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

With the `apple` provider, per-activity route-map images are rendered by Apple Web Snapshots. Heatmap embed images are not: a heatmap draws one polyline overlay per activity segment, and each overlay costs ~145 characters of the ~5,000-character snapshot URL limit, so any heatmap with more than a couple of dozen segments is skipped (without running simplification) and rendered by the built-in SVG heatmap renderer instead.

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
- `activityType`, `activityStartTime`
- `hasMapData`, `mapImagePath`
- `mapError` — why the route map is missing, when one was expected. Deliberately separate from `processingStatus`/`importError`: those mean "this activity is not usable" and gate the status detail dashboard, the post's stat grid, the fitness overview, the profile's Fitness tab and every stats/heatmap rollup, so reusing them for a missing image would hide hundreds of good imports during a tile-server or storage outage. Nullable, and null is the norm — no GPS data, a privacy location leaving no exposed route, and a map that rendered fine all leave it null. Cleared on every successful (re)processing run. The post surfaces it to its **owner only**, and as a closed vocabulary rather than the reason — `fitness.mapFailure` is `missing` (none could be produced) or `stale` (the previous one is still shown, because the run that should have replaced it failed), so each surface's copy matches what the post actually shows. The status payload is readable by every viewer, while the reason is a raw error string that can name internal infrastructure, so it is rendered only on the owner's own fitness files page.
- `mapImageEmailPath` — path of a JPEG copy of the route map in `mapImagePath`, stored for the activity-import email only. Every image the media storages write is WebP, which Outlook desktop (Word rendering engine) and Windows Mail cannot decode, so those recipients saw the image's alt text instead of their route. The copy is not attached to the status and never federates. Nullable, and only written by an import that is going to email the owner — checked against `notifyOnComplete`, the instance having email configured, and the owner's activity-import email preference, so instances that send no email store no copies. An activity with no GPS data has no map at all, and activities imported before this column existed keep pointing their (already sent) email at the WebP. Because it has no `medias` row, the fitness file is its only reference: it is deleted wherever that reference is dropped — deleting the activity, deleting the post with `delete_media=true`, reprocessing or re-importing the file, **Regenerate maps** replacing or removing the map it was made from, and `scripts/fitness/repairStravaActivityFiles.ts --delete-missing` — `scripts/maintenance/cleanupMediaStorage.ts` treats it as referenced rather than orphaned, and `scripts/backup/productionArchive.ts` archives it with the other media. Its bytes are checked against the account quota before being written but are not added to the usage counters, which are maintained alongside `medias` rows. Deleting a post _without_ `delete_media` keeps the copy, which is the same thing that happens to the WebP the post displayed: the activity itself, and so the reference, survives.
- `deviceManufacturer`, `deviceName`
- `gearId` — the bike or pair of shoes this activity is attributed to, or null. See Gear Tracking below. Deliberately a plain indexed column with no database-level foreign key: adding one through `alterTable` needs a table rebuild on SQLite, so the relationship is enforced in `lib/database/sql/fitnessGear.ts` instead, and deleting gear nulls the column in the same transaction.
- `deviceGearId` — the `kind: 'device'` gear row for the head unit or watch that recorded this activity, or null. Resolved from `deviceName`/`deviceManufacturer` on import; those two stay the immutable recorded facts while the gear row carries the owner's editable name, brand, model and product page. Same plain-indexed-column-with-no-FK treatment as `gearId`, and deleting the device detaches it the same way.
- `createdAt`, `updatedAt`, `deletedAt`

Route heatmap caches are stored in `fitness_route_heatmaps`. They are keyed by actor, activity type, period, and region and store serialized route segments rather than generated PNG files. A nullable `shareToken` column backs the shareable/embeddable heatmap views (iframe + image). User-assigned names for heatmap regions are persisted separately in `fitness_route_heatmap_region_names` (keyed by actor and region) so they survive reloads.

## Gear Tracking

Bikes, shoes and recording devices all live in `fitness_gears`, and the parts bolted to a bike in `fitness_gear_components` (both tables added by `migrations/20260811000000_add_fitness_gear.js`; the device kind's identity and product-page columns by `migrations/20260813000000_add_fitness_device_gear.js`).

**Lifetime distance is never stored.** A gear total is `SUM(fitness_files.totalDistanceMeters) WHERE gearId = ?`, and a component total is the same sum restricted to activities whose `activityStartTime` falls inside the component's `[addedAt, removedAt)` install window — a null `addedAt` means "since the gear's beginning" and a null `removedAt` means "still installed". Both rollups reuse the same `deletedAt IS NULL` + `processingStatus = 'completed'` + `isPrimary` filter as `getFitnessActivitySummary`, so gear numbers line up with the fitness overview. Storing the totals instead would have to be reconciled on every back-dated upload, archive re-import, activity edit and delete; derived totals are always consistent with the calendar for free.

An activity with no `activityStartTime` — a GPX carrying no timestamps — counts toward its gear's total but only toward components whose window is open on that side, because an activity that cannot be placed in time cannot be placed inside `[addedAt, removedAt)` either. A gear total may therefore exceed the sum of its components' totals. For the same reason such an activity is counted here but not by `getFitnessActivitySummary`, which additionally requires a non-null `activityType` and `activityStartTime` to group by.

`fitness_gears` columns: `id`, `actorId`, `kind` (`bike`, `shoes` or `device`), `name`, `brand`, `model`, `bikeType`, `weightKilograms`, `defaultSports` (a JSON-encoded array of canonical sport keys, in a `text` column so every backend behaves alike), `alertDistanceMeters`, `lastAlertedDistanceMeters`, `notes`, `deviceKey`, `productUrl`, `retiredAt`, and the usual timestamps with a soft-delete `deletedAt`.

`fitness_gear_components` columns: `id`, `gearId`, `componentType` (named that way to avoid the MySQL reserved word `type`), `brand`, `model`, `addedAt`, `removedAt`, `serviceDistanceMeters`, `lastAlertedDistanceMeters`, timestamps and `deletedAt`.

- **Default sports** map an incoming activity to gear automatically. `fitness_files.activityType` is free-form — FIT, TCX, Strava and GPX each use a different vocabulary — so `lib/services/fitness-files/sportTypes.ts` normalises it to a canonical key (`ride`, `gravel_ride`, `mountain_bike_ride`, `ebike_ride`, `virtual_ride`, `run`, `trail_run`, `walk`, `hike`) and gear stores those keys. A sport belongs to at most one of an actor's gears; claiming it moves it off whichever gear held it. `processFitnessFileJob` assigns gear once the activity type is known, and only when the file has none — a manual assignment always wins. This mapping is the **only** source of automatic attribution, and it is editable from two places: each gear's own form, and the **Default gear** section of the Strava settings page, which lists it as activity type → gear.
- **Retiring** takes gear out of the pickers and out of auto-assign; its total is frozen by the absence of new activities. Retired gear stays explicitly assignable, so old activities can still be attributed to a bike that has since been sold.
- **Recording devices are a third kind** (`kind: 'device'`, added by `migrations/20260813000000_add_fitness_device_gear.js`), and they share very little with a bike: no components, no default sports, no distance total, no service reminder and no retiring. A device page reports an activity count and a first-used date instead — a head unit records rides and runs alike, so summing their distances would produce a number that means nothing.
  - `deviceKey` is the device's immutable **identity**, derived only from what the file recorded: `name:<lowercased, whitespace-collapsed deviceName>`, else `mfr:<brand key>` for a manufacturer the brand map knows, else nothing at all (and then no row is created). It is UNIQUE with `actorId` and is never rewritten. `name`, `brand`, `model` and `productUrl` are display overrides the owner may edit freely — keying on the name instead would fork a duplicate row the first time someone renamed "Garmin Edge 840" to "the Edge".
  - **Devices are system-created only.** `resolveDeviceGear` is the sole writer, called by the import jobs wherever they write the device columns; `POST /api/v1/fitness/gear` rejects `device` with a 422, because a hand-made row would carry no `deviceKey` and so would match no upload. `productUrl` is seeded from the brand map on creation, so the manufacturer link the activity page used to render inline moves onto the device row.
  - Deleting a device **releases its `deviceKey`** in the same transaction that soft-deletes it, alongside detaching `fitness_files.deviceGearId`. The unique index covers soft-deleted rows, so without that release the next upload from that device could never create a row again.
  - The device rollups **relax** the shared predicate's `isPrimary` clause rather than dropping it. A merged same-ride post keeps one file and marks the rest non-primary, which is right for a bike; for a device it depends on why they were merged. Two devices on one ride: the secondary file is the only record the second device left, so it counts. One device that produced two files for one ride (a `.fit` beside a `.gpx`, a manual upload beside the Strava sync): both carry the same device, so counting both would report the ride twice. A secondary file therefore counts only when the primary of its own merged post belongs to a different device, and the activity list applies the same predicate so a device's count and its page always agree.
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

- `GET` and `POST /api/v1/fitness/gear` — list and create. Each list entry carries its derived rollup, batched into one grouped query **per kind**: bikes and shoes report `distanceMeters` and `activityCount`, devices report `activityCount` and `firstUsedAt` (with `distanceMeters` fixed at 0). `POST` accepts only `bike` and `shoes`; a `device` is a 422.
- `PATCH` and `DELETE /api/v1/fitness/gear/:id` — `kind` is immutable, and so is a device's `deviceKey`. `productUrl` is accepted for a device and rejected for anything else, exactly as `bikeType`/`weightKilograms` are bike-only and `alertDistanceMeters` is shoes-only. Deleting soft-deletes the gear, nulls `gearId` and `deviceGearId` on its activities, and releases the device key — all in the same transaction.
- `POST /api/v1/fitness/gear/:id/retire` — one idempotent toggle taking `{ "retired": true | false }`, rather than separate retire and unretire verbs. A device is a 422: retiring means "out of the pickers and out of auto-assign", and a device is in neither.
- `GET /api/v1/fitness/gear/:id/activities` — a page of the activities attributed to this gear, newest first, matching on `deviceGearId` for a device and `gearId` for everything else. Takes `limit` (default 20, clamped to 1–100) and `offset`, and answers `{ activities, hasMore }` — `hasMore` comes from fetching one row past the page rather than a second COUNT over a history that can run to five figures.
- `GET` and `POST /api/v1/fitness/gear/:id/components` — a device is a 422 on every component endpoint; it has no parts to service.
- `PATCH` and `DELETE /api/v1/fitness/gear/:id/components/:componentId`
- `POST /api/v1/fitness/gear/:id/components/:componentId/replace` — closes the fitted part at today's date and opens a fresh one at 0 km carrying the same component type and service interval. A single endpoint because the two writes have to be atomic and because what the replacement inherits is a server-side rule.

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
- `scripts/fitness/importFitnessGear.ts` — creates gear and component history from a JSON file and attributes existing activities to it by matching `activityStartTime`, for activities imported before gear tracking existed; idempotent, supports `--dry-run`, `--overwrite` and `--tolerance-seconds`
- `scripts/fitness/convertStravaExportToGearImport.ts` — builds that import file's assignments from a Strava export's `activities.csv` (the only record of which gear each historical activity used), merged with a hand-authored gear description
- `scripts/fitness/backfillFitnessDevices.ts` — links already-stored activities to a `kind: 'device'` gear row, resolved from the `deviceName`/`deviceManufacturer` they were recorded with; dry run by default, `--apply` to write, idempotent
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
- Privacy locations trim the head and tail of a route — not its middle — from route maps and route-data responses. A route that re-enters a zone part-way through is exposed there; see the Processing Pipeline above for why. When the trims leave no route, the map image is not rendered at all.
- **Route heatmaps are the exception, and always were: the trim changes what the owner's own view highlights, not what a public embed shows.** The heatmap cache stores the head/tail flag per activity — annotated per file, before the activities are pooled, so every activity's own ends are marked rather than only the first and last of the pool — and the owner's authenticated view renders those segments distinctly. `flattenPrivacySegmentsForPublic` then drops the flag for public and shared embeds while **keeping every coordinate**, deliberately: a hole where a route's ends should be pinpoints the private location as precisely as the coordinates do, so neither a gap nor a highlight is an option. Public heatmap embeds therefore render full near-home geometry, unchanged by this rule. See the comment on `flattenPrivacySegmentsForPublic` for the trade-off the instance owner accepted.
- **The uploaded file is owner-only, because trimming cannot apply to bytes the server merely stores.** `GET /api/v1/fitness-files/:id` serves the original `.fit`/`.gpx`/`.tcx`, which still contains the full track including the ends the map and route data trim — so serving it to a viewer handed back exactly what every other surface had just hidden. It used to answer any request whenever the attached status was public or unlisted, and three surfaces linked it for every viewer — the activity detail footer, the shared post's fitness card, and the fitness attachment card in a DM. All four are now restricted to the owner. **The file name is not**: it still renders for every viewer on each of those cards, because it is the card's label and what the multi-file selector switches between. Only the download goes — if you would not want the file name itself read by strangers, rename it or keep the activity below public visibility. Nothing federated is affected: the URL is stripped from every outbound payload and never appeared in an email.
- **Fitness objects must never be reachable through the media route, and `GET /api/v1/files/*` refuses them.** This guard is load-bearing, not defensive: with `ACTIVITIES_FITNESS_STORAGE_TYPE` unset — the default — fitness storage falls back to media storage _inside the media root_, under a `fitness/` key prefix in the same S3 bucket, or a `fitness` directory under `ACTIVITIES_MEDIA_STORAGE_PATH`. The media route has no access control at all and redirects to the public CDN hostname when one is configured, so without the reservation it is a way around the owner-only gate above. The reserved prefixes come from `getMediaReservedFitnessPathPrefixes` and cover the configurable `ACTIVITIES_FITNESS_STORAGE_PREFIX` as well; media objects are written under `medias/` — including route maps and their JPEG email copies — so nothing legitimate is caught.
- File type validation and quota enforcement prevent unsupported uploads and storage abuse.
- Anonymous public route-data responses rely on HTTP caching plus upstream deployment controls for flood protection. Configure a CDN or reverse-proxy rate limiter for `/api/v1/fitness-files/*/route-data` on self-hosted public instances.
