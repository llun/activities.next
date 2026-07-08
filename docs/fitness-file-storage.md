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

If no fitness-specific storage is configured, the app falls back to the media storage backend with a separate local `fitness` directory or S3 `fitness/` prefix.

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
- `activityType`, `activityStartTime`
- `hasMapData`, `mapImagePath`
- `deviceManufacturer`, `deviceName`
- `createdAt`, `updatedAt`, `deletedAt`

Route heatmap caches are stored in `fitness_route_heatmaps`. They are keyed by actor, activity type, period, and region and store serialized route segments rather than generated PNG files. A nullable `shareToken` column backs the shareable/embeddable heatmap views (iframe + image). User-assigned names for heatmap regions are persisted separately in `fitness_route_heatmap_region_names` (keyed by actor and region) so they survive reloads.

## API Endpoints

### Upload and Retrieval

- `POST /api/v1/fitness-files` uploads a fitness file through multipart form data.
- `GET /api/v1/fitness-files/:id` returns file content or redirects to object storage.
- `GET /api/v1/fitness-files/:id/route-data` returns parsed route samples and analysis series for status detail maps and charts.
- `GET /api/v1/fitness-files/by-status?statusId=...` returns fitness files attached to a status.
- `DELETE /api/v1/accounts/fitness-files/:fitnessFileId` deletes an uploaded fitness file.

### Account Fitness Data

- `GET /api/v1/accounts/:id/fitness-summary`
- `GET /api/v1/accounts/:id/fitness-calendar`
- `GET /api/v1/accounts/:id/fitness-activity-types`
- `GET` and `DELETE /api/v1/accounts/:id/fitness-route-heatmaps`
- `GET`, `POST`, and `DELETE /api/v1/accounts/:id/fitness-route-heatmap`

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

### Map Provider Tokens

- `GET /api/v1/fitness/apple-maps-token` returns a short-lived (30 minute) signed MapKit JS token used to initialise Apple Maps in the browser. It responds `404` unless `ACTIVITIES_FITNESS_MAP_PROVIDER=apple`.

This endpoint is **anonymous / unauthenticated** on purpose: public embeds and shared heatmap pages render maps for logged-out visitors, so there is no session to authenticate against. Abuse of a leaked token is bounded by the token's `origin` claim, which is restricted to this instance's own origins (`ACTIVITIES_HOST` plus any trusted hosts) and compared by MapKit against the browser's `Origin` header. Responses are sent with `Cache-Control: no-store` so no intermediary cache or CDN stores and replays the credential.

## Processing Pipeline

1. The post box uploads the selected fitness file and attaches its ID to a new status.
2. `processFitnessFileJob` downloads the stored file, parses `.fit`, `.gpx`, or `.tcx` data, and updates the `fitness_files` metadata.
3. Privacy locations from fitness settings are applied before route maps or route-data responses expose coordinates.
4. If visible GPS coordinates remain, a route map PNG is generated, stored as media, and inserted as the first status attachment named `Activity route map`.
5. Empty fitness posts are backfilled with an activity summary.
6. The status is published to followers and route heatmap cache jobs are queued.

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
- `scripts/fitness/repairFailedFitnessImports.ts`
- `scripts/fitness/cleanupLegacyFitnessHeatmaps.ts`
- `scripts/fitness/cleanupLegacyHeatmapRegions.ts`
- `scripts/fitness/repairStravaActivityFiles.ts`
- `scripts/fitness/retrigerStravaActivities.ts`
- `scripts/fitness/runImportStravaActivity.ts`
- `scripts/fitness/listStravaWebhooks.ts`

See [Maintenance Scripts](maintenance.md) for general script guidance.

## Security and Privacy

- Fitness files can contain sensitive location data.
- Fitness posts default to private visibility in Strava flows unless the user chooses otherwise.
- Privacy locations hide configured coordinate radii from route maps, route-data responses, and route heatmaps.
- File type validation and quota enforcement prevent unsupported uploads and storage abuse.
- Anonymous public route-data responses rely on HTTP caching plus upstream deployment controls for flood protection. Configure a CDN or reverse-proxy rate limiter for `/api/v1/fitness-files/*/route-data` on self-hosted public instances.
