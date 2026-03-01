# Strava Import CLI Design

## Goal

Add a local-only script that can run `importStravaActivityJob` against the app
database while supplying Strava credentials from CLI flags instead of reading
them from the actor's saved `fitness_settings`.

## Problem

The current job payload only accepts `actorId` and `stravaActivityId`. At
runtime the job always loads Strava credentials from `fitness_settings`, and
token refresh writes back through that row. That makes local debugging hard
when we want to reproduce production API behavior with a one-off production app
id, secret, and access token, without mutating local stored settings.

## Constraints

- The script must not write the provided Strava credentials into the database.
- The real job path should be exercised as much as possible so failures are
  representative.
- The job still needs the app database for actor lookup and for persisting the
  imported status, files, and attachments.
- Existing queued behavior must remain unchanged for production traffic.

## Chosen Approach

Extend `importStravaActivityJob` to accept an optional `stravaAuth` object on
the job payload:

- `appId`
- `appSecret`
- `accessToken`

When `stravaAuth` is present, the job will:

- skip loading Strava credentials from `fitness_settings`
- skip token refresh logic that depends on database-backed settings
- use the provided access token for Strava API calls

When `stravaAuth` is absent, the job will preserve the current behavior and use
database-backed settings plus refresh logic.

Add a new script, `scripts/runImportStravaActivity.ts`, that:

- loads Next.js env like existing scripts
- validates named CLI flags
- looks up the app database
- invokes `importStravaActivityJob` directly with a synthetic job message
- exits non-zero on failure

## Alternatives Considered

### 1. Temporarily write credentials into `fitness_settings`

Rejected because it mutates local state, obscures the test setup, and can mask
whether failures come from the job itself or the setup shim.

### 2. Build a separate one-off debug flow outside the job

Rejected because it would drift from the real import path and reduce the value
of local reproduction.

### 3. Extract the whole job body into a shared helper first

Reasonable, but larger than needed for the debugging workflow. The optional
payload override is the smaller change with lower regression risk.

## Data Flow

1. CLI parses `actorId`, `activityId`, `stravaAppId`, `stravaAppSecret`, and
   `accessToken`.
2. CLI obtains the application database instance.
3. CLI calls `importStravaActivityJob(database, message)` with the normal job
   name and the extended payload.
4. Job validates the payload and resolves the actor from the database.
5. Job uses CLI-supplied Strava auth when present, otherwise falls back to the
   existing `fitness_settings` path.
6. Job continues through the existing import flow for activity fetch, export
   fetch, fallback note creation, media attachment, and fitness file import.

## Error Handling

- CLI usage errors return exit code `1` with a short usage message.
- Missing database instance returns exit code `1`.
- Job exceptions are allowed to propagate to preserve the original failure.
- Secrets are never echoed back in success or error logs.

## Testing Plan

- Add a unit test that proves `importStravaActivityJob` can run with
  CLI-supplied auth and without stored `fitness_settings`.
- Keep at least one existing test covering the database-backed settings path to
  guard regressions.
- Smoke test the new script locally with `node`/`@swc-node/register`.
