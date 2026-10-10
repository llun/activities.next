# Maintenance Scripts

This guide covers maintenance and administrative scripts available in Activity.next.

## Database Queue Worker

When the database queue runs in a separate process, start the worker with the
same environment and local database configuration as the application:

```bash
node scripts/run.cjs scripts/maintenance/runQueueWorker.ts
```

`SIGINT` and `SIGTERM` share one shutdown operation. The worker stops accepting
new queue work, waits for the current runner tick to drain, and then closes the
database within a 30-second deadline. Repeated signals keep waiting for that
same operation. A failed or expired shutdown exits unsuccessfully; any claim
left in progress remains eligible for stalled-job recovery.

## Media Storage Cleanup

The `cleanupMediaStorage.ts` script helps you clean up orphaned media files that are no longer referenced in the database. This is useful for reclaiming storage space after content deletion or database recovery.

### What it does

The script:

1. Connects to your database and retrieves all media file paths — both the `medias` rows (`original` and `thumbnail`) and `fitness_files.mapImageEmailPath`, the JPEG copy of a route map kept for the activity-import email, which lives in media storage without a `medias` row of its own
2. Lists all files in your configured storage (local filesystem or S3)
3. Identifies files that exist in storage but are not referenced in the database
4. Optionally deletes these orphaned files

Stored paths are already relative to the storage root, so they are compared as-is; only an absolute path recorded by an older deployment is rebased onto the configured storage path. Always run `--dry-run` first and check that the list looks like genuine leftovers: if it names every file you have, stop — that is a symptom of a path mismatch, not of a storage full of orphans.

### Usage

```bash
# Preview what would be deleted (recommended first step)
./scripts/maintenance/cleanupMediaStorage.ts --dry-run

# Clean up with interactive confirmation
./scripts/maintenance/cleanupMediaStorage.ts

# Clean up without confirmation (use with caution!)
./scripts/maintenance/cleanupMediaStorage.ts --yes

# Show help
./scripts/maintenance/cleanupMediaStorage.ts --help
```

### Options

- `--dry-run` - Show what would be deleted without actually deleting anything
- `--yes` - Skip confirmation prompt and delete immediately
- `--help` - Display help message

### Storage Support

The script supports all storage backends configured for Activity.next:

- **Local File Storage** (`fs`) - Scans the directory specified in `ACTIVITIES_MEDIA_STORAGE_PATH`
- **S3 Storage** (`s3`) - Lists objects in the S3 bucket specified in `ACTIVITIES_MEDIA_STORAGE_BUCKET`
- **Object Storage** (`object`) - Works with any S3-compatible storage (DigitalOcean Spaces, MinIO, etc.)

### Requirements

The script requires:

- Database connection configured (same as your main application)
- Media storage configured with appropriate environment variables
- Read/write permissions for the storage backend

### Examples

#### Local File Storage

```bash
# Set up environment
export ACTIVITIES_HOST=your.domain.tld
export ACTIVITIES_SECRET_PHASE=your-secret
export ACTIVITIES_DATABASE_CLIENT=better-sqlite3
export ACTIVITIES_DATABASE_SQLITE_FILENAME=/data/activities.db
export ACTIVITIES_MEDIA_STORAGE_TYPE=fs
export ACTIVITIES_MEDIA_STORAGE_PATH=/data/media

# Preview cleanup
./scripts/maintenance/cleanupMediaStorage.ts --dry-run

# Perform cleanup with confirmation
./scripts/maintenance/cleanupMediaStorage.ts
```

#### S3 Storage

```bash
# Set up environment
export ACTIVITIES_HOST=your.domain.tld
export ACTIVITIES_SECRET_PHASE=your-secret
export ACTIVITIES_DATABASE_CLIENT=pg
export ACTIVITIES_DATABASE_PG_HOST=localhost
export ACTIVITIES_DATABASE_PG_DATABASE=activities
export ACTIVITIES_MEDIA_STORAGE_TYPE=s3
export ACTIVITIES_MEDIA_STORAGE_BUCKET=my-media-bucket
export ACTIVITIES_MEDIA_STORAGE_REGION=us-east-1

# Preview cleanup
./scripts/maintenance/cleanupMediaStorage.ts --dry-run

# Perform cleanup without confirmation
./scripts/maintenance/cleanupMediaStorage.ts --yes
```

### When to Use

Run this script when:

- You've deleted posts or accounts and want to reclaim storage space
- After restoring from a database backup
- During regular maintenance to ensure storage consistency
- You suspect orphaned files are consuming unnecessary space

### Safety

The script includes several safety features:

- Dry-run mode to preview changes before deletion
- Interactive confirmation prompt (unless `--yes` is used)
- Only deletes files not referenced in the database
- Provides detailed output of what was deleted

**Warning**: Always run with `--dry-run` first to verify the files to be deleted are indeed orphaned.

## Production Snapshot Backup and Restore

Activity.next provides scripts to create a full, standalone archive of a production instance (database rows and storage files) and to restore that snapshot into a local development environment.

### Downloading a Production Archive

The `downloadProductionArchive.ts` script connects to your production database, exports all table data (chunked in pages), and packages referenced media/fitness files into a gzip-compressed tar archive (`.tar.gz`):

```bash
# Download production archive with referenced media/fitness files (default)
NODE_ENV=production ./scripts/backup/downloadProductionArchive.ts

# Include all files in storage, even unreferenced ones
NODE_ENV=production ./scripts/backup/downloadProductionArchive.ts --storage-scope all

# Export database rows only (skip storage files)
NODE_ENV=production ./scripts/backup/downloadProductionArchive.ts --skip-storage

# Show help and available options
./scripts/backup/downloadProductionArchive.ts --help
```

#### Options

- `--env-file <path>` — Path to the environment configuration file to load (default: `.env.production`).
- `--output-dir <path>` — Destination directory for archives (default: `backups/production-archives`).
- `--storage-scope <referenced|all>` — Scope of files to include: `referenced` (default; only files linked to database rows) or `all` (every object in storage).
- `--allow-missing-storage` — Warn and continue if a referenced storage object cannot be fetched, recording missing items in the archive manifest.
- `--skip-database` — Package storage files only without exporting database tables.
- `--skip-storage` — Export database tables only without packaging storage files.

### Restoring a Production Archive into Local Development

The `restoreProductionArchive.ts` script restores a downloaded archive into your local development environment: it validates local database connectivity, imports database tables in topological foreign-key order, runs Knex migrations to ensure schema currency, and extracts storage files into your local storage directory.

```bash
# Restore an archive into your local environment
./scripts/backup/restoreProductionArchive.ts \
  --archive backups/production-archives/activitynext-production-2026-09-01T12-00-00.tar.gz \
  --yes

# Restore only the database tables
./scripts/backup/restoreProductionArchive.ts \
  --archive backups/production-archives/activitynext-production-2026-09-01T12-00-00.tar.gz \
  --database-only \
  --yes
```

#### Options

- `--archive <path>` — **Required.** Path to the `.tar.gz` production archive to restore.
- `--yes` — **Required.** Confirmation flag acknowledging that restoring overwrites local data.
- `--env-file <path>` — Environment file to load for local target settings (default: `.env.local`).
- `--database-only` — Restore database tables only; skip extracting files.
- `--files-only` — Extract storage files only; skip restoring database tables.
- `--preserve-files` — Keep existing local files instead of replacing them during file extraction.
- `--allow-non-local-database` — Override the safety guard that prevents restoring to non-local databases (use with extreme caution).

#### Safety

To prevent accidental data loss or clobbering of a live instance:

- `restoreProductionArchive.ts` strictly refuses to run when `NODE_ENV=production`.
- The script checks that the target database hostname is a local address (e.g. `localhost`, `127.0.0.1`, `::1`, or SQLite file) and refuses remote hostnames unless `--allow-non-local-database` is explicitly passed.

## Actor Archive Export

The `exportActorArchive.ts` script exports everything belonging to one **local**
actor into a Mastodon-compatible ActivityPub archive (`.tar.gz`): every status
regardless of visibility (public, unlisted, followers-only, direct), media
attachment bytes, fitness activity files and route maps (an extension beyond
the Mastodon archive format — includes imported activities that were never
posted), the actor profile, likes, bookmarks, and follow lists. It is
read-only against the database and storage.

### Usage

```bash
NODE_ENV=production ./scripts/backup/exportActorArchive.ts --username alice
NODE_ENV=production ./scripts/backup/exportActorArchive.ts --actor-id https://your-domain.tld/users/alice
NODE_ENV=production ./scripts/backup/exportActorArchive.ts --email alice@example.com

# Preview the flags without connecting to anything
./scripts/backup/exportActorArchive.ts --help
```

Pass exactly one of `--username` (optionally with `--domain`, defaulting to
the configured host), `--actor-id`, or `--email` to select the actor.

### Options

- `--env-file <path>` — env file to load (default `.env.production`; use
  `.env.local` for a local export)
- `--output-dir <path>` — output directory (default `backups/actor-archives`)
- `--page-size <n>` — pagination batch size for every collection (default 100)
- `--allow-missing-storage` — warn and continue instead of aborting when a
  referenced media or fitness file is missing from storage; failures are
  recorded per-file in the archive's `manifest.json`
- `--skip-storage` — write only the JSON/CSV files, no media or fitness bytes
  from this instance's own storage. It does **not** suppress
  `--fetch-remote-attachments`; pass neither flag for an archive with no media
  bytes at all
- `--fetch-remote-attachments` — download attachments hosted on other servers
  into the archive too (by default their absolute URL is kept as-is, since
  the export only owns the actor's own storage). These URLs come from the
  posts themselves rather than from your configuration, so each download is
  SSRF-guarded — non-HTTPS URLs and any host resolving to a loopback,
  link-local or private address are refused, re-checked on every redirect hop,
  with at most 3 hops followed — and capped at the resolved
  `media.maxFileSize` server setting, the same ceiling an upload to this
  instance gets. One attachment gets 10 minutes in total — covering every hop,
  the body as well as the headers — so a slow host cannot restart the clock by
  redirecting, and the run as a whole stops starting new downloads once
  `--remote-fetch-budget` is spent. A refused, over-size or budget-skipped
  attachment is recorded as a warning in `manifest.json` and its absolute URL
  is kept, exactly as if the flag had not been passed. Two caveats worth
  knowing before you use it on a hostile account: the size cap bounds each
  attachment on its own and nothing bounds their total, so a large history can
  still fill the temporary directory the archive is staged in even though
  `--remote-fetch-budget` now bounds how long the run takes; and a downloaded
  file's extension comes from the URL rather than from its contents, so treat
  an extracted archive's `media_attachments/remote/` as untrusted rather than
  serving it over HTTP
- `--remote-fetch-budget <seconds>` — how long the export may go on **starting**
  remote attachment downloads (default 3600). Inert without
  `--fetch-remote-attachments`. The per-attachment ten minutes above bounds one
  download; this bounds their sum, which otherwise ran to days for an account
  whose posts point at hosts that drip bytes just under that ceiling — the case
  you are most likely to meet, since the flag gets used for bans, moderation
  actions and legal requests. Exhausting it costs nothing that was already
  running: a download in flight always finishes, and every attachment reached
  afterwards simply keeps its absolute URL and is warned about, exactly as if
  the flag had not been passed. The archive records how many were skipped that
  way as its own `manifest.json` warning, distinct from a download that
  actually failed, so re-running with a larger budget is an informed choice.
  Because nothing is aborted mid-flight, the real ceiling is the budget plus
  the ten minutes the last attachment to start may still take. A budget must be
  a positive whole number of seconds; pass a very large one to go back to
  effectively no limit

### Archive layout

```
actor.json                    Person profile (avatar/header rewritten to local files)
outbox.json                   OrderedCollection of Create/Announce activities, every status
likes.json / bookmarks.json   OrderedCollections of status URIs
following_accounts.csv        Mastodon-import-compatible CSV
followers.csv                 Extension: one handle per line
avatar.* / header.*           Profile images, when present
media_attachments/files/      Attachment, thumbnail, and route-map bytes
media_attachments/remote/     Only with --fetch-remote-attachments
fitness_files/files/          .fit/.gpx/.tcx bytes
fitness_files/fitness.json    Every fitness activity, including ones with no post
status_history.json           Edit history for edited statuses
manifest.json                 Counts, storage results, and warnings
```

Unlike the ActivityPub outbox route, every attachment on a status is kept
(the federation format truncates to a handful and drops fitness attachments),
and every visibility is included — this is an owner's export, not a
visitor's view. Like `productionArchive.ts`, it prints the resolved database
connection before doing anything, and `@next/env` loads `.env.local` at
higher precedence than `.env.production` even under `NODE_ENV=production` —
verify the printed banner shows the database you intend before trusting the
output.

## Public ID Backfill

The `backfillPublicIds.ts` script fills `publicId` for `statuses` and `actors`
rows that still have `NULL` after the `20260808000000_add_public_ids` migration,
minting a UUIDv7 from each row's `createdAt` so the ids stay time-ordered
exactly as the migration produced them.

### Why it is needed

The migration cannot finish the job by itself, and this is inherent to the
deploy order rather than a gap in it:

- `yarn migrate` runs **first**, from a checkout against the live database,
  while the **previous** image keeps serving traffic — the runtime image ships
  no Knex CLI (see [PostgreSQL Setup](postgresql-setup.md)).
- The new build cannot start any earlier: its `INSERT`s write a `publicId`
  value, so it needs the column the migration adds.
- That concurrent writer is therefore the **pre-publicId** build, and every row
  it inserts leaves `publicId` `NULL`. Rows written after the migration's sweep
  converges — right through to the end of the rollout — are beyond anything the
  migration could catch, which is why it logs them instead of failing.
- Nothing repairs them later on its own: `publicId` is only ever minted on
  insert, there is no lazy mint, and `yarn migrate` is a **no-op** once knex has
  recorded the migration.

### When to Use

Run this once **after the new build is fully rolled out** — when no pre-publicId
pod is still serving — and **before deploying the emitting build**: the change
that makes the Mastodon API return `publicId`s as `Status.id` / `Account.id`
(and as pagination cursors) and moves web status pages to
`/@username@domain/<publicId>`. This script must exit `0` ("No NULL publicId
rows remain") **before** that build ships, not after — that exit code is the
deploy gate.

Missing the gate is degrading, not fatal, which is exactly why it is easy to
miss. Every legacy id form stays resolvable on input forever, and a row with no
`publicId` simply keeps emitting the legacy colon-encoded id — so the instance
serves two id shapes for the same kind of entity instead of failing loudly. It
does not heal on its own either: `publicId` is only minted on insert, so those
rows keep the old shape until this script is run. If the emitting build is
already live and rows are still `NULL`, run it now — it is safe at any point.

Also run it any time the migration's final output reported rows inserted after
the sweep converged, or after restoring a backup taken mid-rollout.

### Usage

```bash
# Preview what would be backfilled (recommended first step)
NODE_ENV=production ./scripts/maintenance/backfillPublicIds.ts --dry-run

# Backfill
NODE_ENV=production ./scripts/maintenance/backfillPublicIds.ts

# Smaller passes on a busy database
NODE_ENV=production ./scripts/maintenance/backfillPublicIds.ts --batch-size 100

# Show help
./scripts/maintenance/backfillPublicIds.ts --help
```

### Options

- `--dry-run [true|false]` - Report what would be backfilled without writing anything
- `--batch-size <n>` - Rows per pass (default 500)
- `--help` - Display help message

### Output

Each table reports how many rows were backfilled, how many were skipped, and how
many still have a `NULL` publicId, followed by a total:

```
Summary
  statuses: 2 backfilled, 0 skipped (NULL id), 0 still NULL
  actors: 1 backfilled, 0 skipped (NULL id), 0 still NULL
  total: 3 backfilled, 0 skipped (NULL id), 0 still NULL

No NULL publicId rows remain. The publicId deploy gate is satisfied.
```

**Exit code `0` means no `NULL` publicId remains anywhere** — read it as the
gate. `1` means some remain, including in `--dry-run`, where nothing was written
so the gate is unmet by definition. If a live run still exits `1`, a
pre-publicId pod is probably still serving: finish the rollout and run it again.

Rows counted as **skipped (NULL id)** have a `NULL` `id` and cannot be addressed
by a per-row `UPDATE` at all (`actors.id` is nullable in both schema dumps).
They keep a `NULL` publicId until their `id` is repaired, and they hold the exit
code at `1`.

### Safety

- Idempotent and safe to run repeatedly against a live production database.
- Every `UPDATE` keeps a `publicId IS NULL` guard, so a value written
  concurrently by the app is never clobbered.
- A row that already has a `publicId` is never rewritten, so ids stay stable.
- Prints the resolved database target before doing anything — verify it is
  production, since `.env.local` shadows `.env.production` even under
  `NODE_ENV=production`.
- Stops instead of looping when a pass selects rows but changes none of them
  (its `UPDATE`s are not taking effect), and says so.

## Notification ID Rewrite

The `rewriteNotificationIds.ts` script rewrites every notification id that is
not time-ordered (a random UUIDv4, from before notifications got UUIDv7 ids)
into a UUIDv7 minted from the row's `createdAt`, and repoints the
`notifications` read marker that named it. A `notifications` marker left on a
non-v7 id that names no notification (dismissed or cleared before the rewrite)
is reset to the highest UUIDv7 for the millisecond the marker was last
written, so it does not sort above every new notification. It runs the same
code as the
`20261009163215_time_ordered_notification_ids` migration
(`lib/database/sql/notificationIdRewrite.js`).

### Why it is needed

Clients such as Ivory sort notifications, and compare the notifications read
marker, by id (see
[Mastodon API compatibility](mastodon-api-compatibility.md)). The migration
rewrites every v4 id it finds, but `yarn migrate` runs **first**, while the
**previous** image keeps serving traffic and keeps minting v4 ids — right up to
the end of the rollout. Those rows do not age out: a v4 id almost always sorts
above every v7 id, so an id-ordering client keeps them at the top of the list
for good and may set its read marker to one, making newer notifications look
read. `yarn migrate` is a no-op once knex has recorded the migration, so this
script is how they get rewritten.

### When to Use

Run it once **after the new build is fully rolled out** — when no pod of the
previous build is still serving. It is safe at any later point too, for example
after restoring a backup taken before or during the rollout.

### Usage

```bash
# Preview how many ids would be rewritten (recommended first step)
NODE_ENV=production ./scripts/maintenance/rewriteNotificationIds.ts --dry-run

# Rewrite
NODE_ENV=production ./scripts/maintenance/rewriteNotificationIds.ts

# Smaller passes on a busy database
NODE_ENV=production ./scripts/maintenance/rewriteNotificationIds.ts --batch-size 100

# Show help
./scripts/maintenance/rewriteNotificationIds.ts --help
```

### Options

- `--dry-run [true|false]` - Count the ids and orphan markers that would be rewritten without writing anything
- `--batch-size <n>` - Rows read per pass (default 500)
- `--help` - Display help message

### Output and exit code

The script reports how many notifications it scanned, how many ids it
rewrote, how many markers it repointed or reset, and how many ids and orphan
markers are left. **Exit code `0` means every notification id is time-ordered
and no `notifications` marker is left on a non-v7 id that names no
notification.** `1` means something is left, including in `--dry-run`, where
nothing was written. If
a live run still exits `1`, a pod of the previous build is probably still
serving: finish the rollout and run it again.

### Safety

- Idempotent and safe to run repeatedly against a live production database:
  rows that already have a UUIDv7 id are never touched.
- Each chunk of up to 200 rows, and the marker pointing into it, is rewritten in
  its own short transaction, one at a time, so the script holds a single pooled
  connection and an interrupted run leaves nothing half-done; re-running
  resumes.
- Prints the resolved database target before doing anything — verify it is
  production, since `.env.local` shadows `.env.production` even under
  `NODE_ENV=production`.
- Ids clients cached before a rewrite stop resolving; see
  [Mastodon API compatibility](mastodon-api-compatibility.md) for what clients
  see and how they recover.

## Gallery Lookup Backfill

Fills in place names, country codes and GBIF/IUCN subject status for gallery media that was uploaded before those lookups existed, or whose lookup never finished. See [Gallery Lookups](environment-variables.md#gallery-lookups) for what is sent where.

### When to Use

- After upgrading to the release that adds smart subjects. **While "Hide the place of threatened species" is on, a photo with a species subject keeps its place hidden from other people until its subject lookup has run**, so existing species photos stay place-hidden until this script (or an edit of the subject) resolves them. A subject `no-match` written by an earlier build no longer clears a place, so the script asks about those again too.
- After a provider outage left lookups `failed`, or after turning a lookup back on in **Admin → Network** (media looked up while it was off is marked `disabled`). Both place and subject lookups that are never-attempted, `pending`, `failed` or `disabled` are picked up again.

It is a script and not a queue fan-out because Nominatim's usage policy forbids bulk bursts: it walks the media in id order and calls the two job handlers directly, one media at a time, through the same in-process rate limiters the jobs use. Nominatim is called at most once a second, so a large library takes a while. Only the centre of the roughly 5 km grid cell of each photo is sent, never the stored point. A `resolved` result, and a place's `no-match`, is final and is never redone; a subject's `no-match` is redone. A place `no-match` stays final because the geocode cache key carries a tag of any non-default Nominatim endpoint, so a wrong or regional endpoint's miss never answers for another one, and a remembered miss for a cell is still used, so photos in one no-match cell cost one request. Safe to repeat.

A provider outage pauses the run instead of failing it. After a timeout, a 5xx or a 429 a provider's circuit opens (for its `Retry-After`, else 5 minutes); the script then logs `<provider> is unavailable; waiting N s before going on`, waits for the circuit to close, asks the lookup that tripped it once more (skipping the failure the lookup cache just remembered), and carries on. A run never marks the rest of a library `failed` because of one blip, and anything still `failed` at the end is picked up by the next run. Every lookup the script makes skips the failures the lookup cache remembers (from the app server, for instance), and a remembered unknown GBIF `species/{key}`, while still using its hits and its other misses (a remembered geocode miss included).

A persistent outage is bounded. After 3 lookups in a row to one provider have failed even after waiting out its circuit, the script logs `Gave up on <provider> … run the backfill again later`, skips that provider's remaining lookups, and carries on with the other one; the summary lists it under `Gave up on`. With the default 5 minute circuit that is at most about half an hour of waiting per provider (longer only if the provider sends a longer `Retry-After`). Run the script again once the provider is back. One photo can also be retried from its details dialog (`POST /api/v1/media/:id/lookups`).

### Usage

```bash
# Preview what would be looked up (the default)
NODE_ENV=production ./scripts/maintenance/backfillGalleryLookups.ts --dry-run

# Run the lookups
NODE_ENV=production ./scripts/maintenance/backfillGalleryLookups.ts --apply

# One actor, subjects only, first 200 media
NODE_ENV=production ./scripts/maintenance/backfillGalleryLookups.ts \
  --apply --actor https://example.com/users/me --only subjects --limit 200

# Also delete expired lookup cache rows
NODE_ENV=production ./scripts/maintenance/backfillGalleryLookups.ts --apply --prune-cache
```

### Options

- `--dry-run` - Report what would be looked up and change nothing (default)
- `--apply` - Run the lookups and write the results
- `--actor <id>` - Only this actor's media
- `--limit <n>` - Stop after `n` media
- `--only subjects|places` - Only one kind of lookup
- `--prune-cache` - Also delete expired rows from `gallery_lookup_cache` (with `--apply`)

## Search Index Rebuild

The `rebuildSearchIndex.ts` script rebuilds full-text search indexes for accounts, hashtags, and statuses. It scans records, regenerates search tokens and searchable text, and updates the search documents table in batches.

You can run it directly or via the convenience package script:

```bash
# Using the yarn script
yarn search:reindex

# Or directly through node
node scripts/run.cjs scripts/maintenance/rebuildSearchIndex.ts
```

Batch sizing can be controlled with the `SEARCH_REINDEX_BATCH_SIZE` environment variable, a positive integer (default: `500`, also used for any other value):

```bash
SEARCH_REINDEX_BATCH_SIZE=1000 yarn search:reindex
```

## Fixing Attachment URLs

The `fixAttachmentUrls.ts` script fixes attachment URLs that were mistakenly stored with a local or incorrect host (such as `localhost:3000`) instead of your production domain. It inspects `attachments.url` and replaces the mismatched host with the target domain.

### Usage

```bash
# Preview changes without modifying any records (recommended first)
NODE_ENV=production ./scripts/maintenance/fixAttachmentUrls.ts --wrong-host localhost:3000 --dry-run

# Run the replacement
NODE_ENV=production ./scripts/maintenance/fixAttachmentUrls.ts --wrong-host localhost:3000

# Explicitly override the target replacement host (defaults to ACTIVITIES_HOST from config)
NODE_ENV=production ./scripts/maintenance/fixAttachmentUrls.ts \
  --wrong-host localhost:3000 \
  --correct-host your-domain.tld
```

### Options

- `--wrong-host <host>` — The bad host to find and replace (default: `localhost:3000`).
- `--correct-host <host>` — The replacement host (defaults to `ACTIVITIES_HOST` read from configuration).
- `--dry-run` — Print rows that would be modified without updating the database.

## Other Scripts

### Create Mock User

Creates a test user for development/testing:

```bash
./scripts/mock/createMockUser.ts [username] [email] [password]
```

> **Note:** This script is for development and testing purposes only. In production, users should register through the web interface at `/auth/signup`.

### Create Mock Statuses

Creates realistic mock statuses (including threaded conversations, polls, mentions, and image attachments) for a local test user to populate timelines for development:

```bash
node scripts/run.cjs scripts/mock/createMockStatuses.ts [username]
```

Defaults to `testuser` if omitted. Run after `createMockUser.ts`.

### Create Mock Fitness Data

Seeds completed primary fitness files (runs, rides, walks with realistic GPS tracks and device metadata) and linked fitness posts for a local test user, so the `/fitness` Overview, calendar, and Recent activities feeds render with realistic data:

```bash
node scripts/run.cjs scripts/mock/createMockFitnessData.ts [username]
```

Defaults to `testuser` if omitted. Run after `createMockUser.ts`.

### Create Mock Fitness Calendar Data

Seeds a deterministic set of fitness activities for a local test user so the `/fitness` Overview's calendar, summary and day details can be checked against the same edge cases every time: viewer-local day boundaries (a 23:45 and a 00:10 activity either side of local midnight), the two daylight-saving days, a leap day, month and year edges, a 22-activity day for day-details pagination, mixed types including an untyped one, and rows the Overview must not count (deleted, non-primary, pending or failed). Nothing is random, so two runs with the same flags write identical rows.

```bash
set -a; . ./.env.local; set +a
node scripts/run.cjs scripts/mock/createMockFitnessCalendarData.ts \
  --anchor 2026-10-04 --time-zone Europe/Amsterdam [--username testuser]
```

`--anchor` is "today" for the seed (nothing is written after the start of that day, plus five minutes) and `--time-zone` is the IANA zone the seed's wall-clock times are read in. Pass both or neither; the defaults are `2026-10-04` and `Europe/Amsterdam`. Open the Overview with the browser in the same zone to see the days where the seed meant them to land. `--username` defaults to `testuser`; run `createMockUser.ts` first.

It **refuses to run against anything but a local database** (local SQLite, or PostgreSQL on `localhost`, `127.0.0.1`, `::1`, `activities.local`, `host.docker.internal` or `postgres`) and prints which database it is about to touch first. Like the other mock scripts it does not load `.env.local`, so export the variables as shown. It is idempotent: every row it writes has a file path under `mock-calendar/` and every post carries the `mock-calendar` application name, so a run deletes the actor's earlier rows under that prefix and inserts the set again, leaving other activities untouched.

### Render Email Previews

Renders every email template to standalone HTML files so a template change can
be checked visually. Emails are not pages, so there is no dev-server route to open —
this is the visual verification step for anything under
`lib/services/email/templates/`.

```bash
./scripts/mock/renderEmailPreviews.ts [outDir]
```

It writes one file per covered template plus an `index.html` that shows each rendered
email beside its plain-text alternative, then prints a `file://` URL. Output goes
to a temporary directory unless `outDir` is given, so nothing lands in the working
tree.

Nothing is sent, no database is opened, and no network request is made — but
`getConfig()` validates the whole environment schema, so a database entry must be
present even though nothing connects to it. Either source an existing
`.env.local`:

```bash
set -a; . ./.env.local; set +a
./scripts/mock/renderEmailPreviews.ts
```

…or pass throwaway values inline:

```bash
ACTIVITIES_HOST=llun.social ACTIVITIES_SECRET_PHASE=preview \
ACTIVITIES_DATABASE_CLIENT=better-sqlite3 \
ACTIVITIES_DATABASE_SQLITE_FILENAME=./unused.sqlite3 \
./scripts/mock/renderEmailPreviews.ts
```

`ACTIVITIES_HOST` is what the templates render in the header and build every link
from, so set it to the instance you want the preview to look like.

> **Note:** A browser is a lower bar than a mail client. For a change to the
> shared layout, also send at least one email to a real inbox and check it in
> Gmail, Apple Mail **and Outlook**, including dark mode. Outlook is the only
> client where the `mso-` properties and the ghost table do anything, so it is
> the one a browser preview cannot stand in for.

### Admin Role Management

Adds or removes the admin role for an account by email:

```bash
NODE_ENV=production ./scripts/maintenance/manageAdminRole.ts add admin@example.com
NODE_ENV=production ./scripts/maintenance/manageAdminRole.ts remove admin@example.com
```

### Fitness, Strava, and Wahoo Maintenance

Wahoo stores each external workout identity and import outcome in `wahoo_imports`; history scans and their progress live in `wahoo_history_imports`. Owners can retry failed or FIT-less workouts individually from **Fitness → Wahoo**, or retry an interrupted date-range scan there. The page shows the last webhook and successful import times. The registered webhook URL ends in `/api/v1/webhooks/wahoo/` and requires the Wahoo application's `offline_data` scope and webhook token. Check the queue worker and Admin → Queues for terminal job failures if an import remains pending; do not delete the provider identity row to force a retry. Status deletion marks its Wahoo imports as durable tombstones in the deletion transaction, including a file attached just before its import row gains a status ID, so delayed revisions cannot recreate an intentionally deleted post. Disconnecting cancels active history work, clears stored Wahoo credentials, and preserves local activities.

Useful scripts for interrupted imports, route heatmap rebuilds, and Strava maintenance:

```bash
NODE_ENV=production ./scripts/fitness/fixStuckFitnessProcessing.ts --actor-id https://your-domain.tld/users/username
NODE_ENV=production ./scripts/fitness/repairFailedFitnessImports.ts --actor-id https://your-domain.tld/users/username --dry-run
NODE_ENV=production ./scripts/fitness/recreateFitnessRouteHeatmaps.ts --actor-id https://your-domain.tld/users/username --dry-run
NODE_ENV=production ./scripts/fitness/repairStravaActivityFiles.ts --actor-id https://your-domain.tld/users/username --dry-run
NODE_ENV=production ./scripts/fitness/backfillFitnessMovingTime.ts --actor-id https://your-domain.tld/users/username --dry-run
NODE_ENV=production ./scripts/fitness/importFitnessGear.ts --actor-id https://your-domain.tld/users/username --input ./gear-import.json --dry-run
NODE_ENV=production ./scripts/fitness/backfillFitnessDevices.ts --actor-id https://your-domain.tld/users/username
NODE_ENV=production ./scripts/fitness/normalizeFitnessActivityTypes.ts --actor-id https://your-domain.tld/users/username
NODE_ENV=production ./scripts/fitness/retrigerStravaActivities.ts --actor-id https://your-domain.tld/users/username --activity-id 123456789
NODE_ENV=production ./scripts/fitness/listStravaWebhooks.ts @username@your-domain.tld
```

> **Note:** `fixStuckFitnessProcessing.ts` has no dry-run/preview mode — it updates stuck files immediately (it also supports a `--status-hash <64-char-hex>` mode instead of `--actor-id`).
>
> **Note:** `repairStravaActivityFiles.ts` only **reports** activities that Strava 404s by default; pass `--delete-missing` to hard-delete their stored file, DB record, and post (irreversible). Every recovery script prints the resolved database target on start — verify it is production (`.env.local` shadows `.env.production` even under `NODE_ENV=production`).
>
> **Note:** `recreateFitnessRouteHeatmaps.ts` soft-deletes the actor's heatmap rows and queues a generation job per variant and region, each rebuilding its own row on its own clock. Only the all-activities/all-time row also rebuilds that actor's **tile pyramid** — what the interactive maps and the share image draw street-level detail from — so a rebuild is heavier than the queued-job count suggests. While that pyramid is `generating` rather than `completed`, nothing serves tiles at all: a row already rebuilt draws its stored geometry, and street-level detail returns only once the build stamps itself completed. A row soft-deleted and not yet rebuilt has nothing to serve, and deleting it also clears its share token, so a previously shared heatmap stays unshared after the rebuild until its owner shares it again.
>
> **Note:** `backfillFitnessMovingTime.ts` recomputes `movingTimeSeconds` for already-stored activity files by re-parsing them, so their average pace/speed switches from elapsed-time to moving-time (matching Strava). New imports already compute it during processing; this only needs running once over historical records. It skips files that already have a moving time (pass `--force` to recompute anyway) and supports `--dry-run` to preview.

#### Linking recording devices onto activities imported before devices had gear rows

`scripts/fitness/backfillFitnessDevices.ts` links an actor's already-stored
activities to a `kind: 'device'` gear row. Those activities have always carried
the `deviceName`/`deviceManufacturer` they were recorded with — the import stores
them — but nothing pointed at a device row, so the gear page showed no Devices
card and the post chip still rendered a manufacturer link. The script groups the
whole history by device identity, resolves each group to one row (creating it if
this is the first sight of that device), and stamps `fitness_files.deviceGearId`
on every file in the group.

It is a **dry run by default**: it prints what it would link and writes nothing
until `--apply` is passed (it takes no `--dry-run` flag, unlike its siblings —
it says so if you pass one). Re-running is safe: only files with a NULL
`deviceGearId` are linked, and the resolver finds the existing row rather than
creating a second one, so a second pass reports nothing left to do. It still
reads the whole history to work that out, so a re-run is cheap in writes rather
than in reads. Activities whose only device field is a bare FIT code nothing
recognises get no row at all, which is the same decision a fresh import makes.

```bash
# Preview, then apply.
NODE_ENV=production ./scripts/fitness/backfillFitnessDevices.ts --actor-id https://your-domain.tld/users/username
NODE_ENV=production ./scripts/fitness/backfillFitnessDevices.ts --actor-id https://your-domain.tld/users/username --apply
```

#### Normalizing activity types stored before they were canonical

`scripts/fitness/normalizeFitnessActivityTypes.ts` collapses an actor's stored
`fitness_files.activityType` values to the canonical activity types (`ride`,
`gravel_ride`, `run`, `training`, `rowing`, `other`, …).

Four vocabularies write that column — FIT `sport`/`sub_sport` (`cycling`,
`gravel_cycling`), Garmin TCX `Sport` (`Biking`), Strava `sport_type` (`Ride`,
`GravelRide`) and free-form GPX text — so the same ride was stored spelled three
different ways. Gear was never affected, because it matches through
`normalizeActivityTypeToSportKey`, but everything that **groups or filters** on
the raw string was: the fitness overview breakdown listed "Cycling", "Biking"
and "Ride" as three separate activities, and the per-type route-heatmap cache
keyed three separate rows. New imports are normalized at parse time, so this
script is only for history imported before that rule.

It is a **dry run by default**: it prints the `old -> new` transitions it would
make and writes nothing until `--apply` is passed (it takes no `--dry-run` flag,
unlike most of its siblings — it says so if you pass one). Re-running is safe:
every canonical key normalizes to itself, so a second pass reports nothing to do.

Gear attribution cannot shift as a result — every value written is a fixed point
of the same function auto-assign reads the column through — so an activity keeps
whatever gear it had. Any activity that does not match a canonical sport key or
canonical non-gear activity collapses to `other`.

```bash
# Preview, then apply.
NODE_ENV=production ./scripts/fitness/normalizeFitnessActivityTypes.ts --actor-id https://your-domain.tld/users/username
NODE_ENV=production ./scripts/fitness/normalizeFitnessActivityTypes.ts --actor-id https://your-domain.tld/users/username --apply
```

Afterwards, rebuild the per-activity-type route heatmaps: their cache keys on
the OLD strings, and the script does not rewrite them (the unique index on
`(actorId, activityTypeKey, periodType, periodKey, region)` means renaming a
`cycling` row to `ride` would collide with the row already built from `Ride`
rather than merge into it). The script prints the exact command, which is the
usual `recreateFitnessRouteHeatmaps.ts` run — read its note above first, since a
rebuild is heavier than the queued-job count suggests.

#### Backfilling gear onto activities imported before gear tracking existed

Gear tracking arrived after most activities did, so anything imported earlier has
no gear at all. Re-importing would duplicate the posts, and automatic attribution
only runs while a file is being processed, which a healthy stored activity never
is again — so `scripts/fitness/importFitnessGear.ts` fills the gap: it creates the gear and its
component history from a JSON file, then attributes existing activities to it.

Each entry is matched by identity first: its `stravaActivityId` against the
activity's `sourceUrl` (or the `strava-<id>.tcx` name the webhook importer
writes), then its `filename` against the stored file name, compared as basenames
with any `.gz` stripped. That names the very row, so it holds however far the two
clocks have drifted — and it reaches an activity carrying no start time at all,
which nothing else can. Only when neither side names the row does the timestamp
decide, matching the nearest activity within `--tolerance-seconds` (default 60).

An entry that matches nothing, ties between two activities, or lands on an
activity another entry already claimed is reported and skipped — never guessed
at, and a skipped entry still reserves the activities it named so a date window
cannot quietly attribute them to a different gear. Two activities sharing one
Strava id tie the same way; a repeated _file name_ does not, since it is weaker
evidence than the timestamp and falls through to it. Activities that already
carry gear are left alone unless `--overwrite` is given, so re-running is free
and never undoes a manual correction.

Always `--dry-run` first. The report lists how far the nearest activity was for
every unmatched entry, so a systematic clock problem shows up as a uniform offset
before anything is written — and it ends with the **unattributed activities**:
the completed, distance-carrying activities the whole plan leaves with no gear,
totalled and broken down by year. Gear totals are derived from exactly those
rows, so that list is what a gear page short against Strava is short by; an
activity whose type maps to no sport key is called out, because nothing can
attribute it automatically.

The script refuses to write at all when the actor has no activities but the file
has assignments (almost always the wrong `--actor-id`, and creating the gear
there would strip default sports off that actor's real gear), when two entries
resolve to the same existing gear, or when a gear exists with a different `kind`.
It exits non-zero if no assignment reached any activity, so a wrong target cannot
pass for a clean run in a script.

```jsonc
{
  "gears": [
    {
      "name": "Moots", // required; the name assignments refer to
      "kind": "bike", // "bike" | "shoes"
      "brand": "Moots",
      "model": "Vamoots RSL disc",
      "bikeType": "Road bike", // bikes only
      "weightKilograms": 8.0, // bikes only
      "alertDistanceMeters": null, // shoes only
      "defaultSports": [], // sport keys this gear auto-claims (see below)
      "retired": false,
      "components": [
        {
          "type": "Chain",
          "brand": "Shimano",
          "model": "CN-HG901-11",
          "addedAt": "2019-09-24", // omit for "since the gear's beginning"
          "removedAt": "2020-04-01" // omit while still installed
        }
      ],
      "windows": [
        // Fallback for activities no assignment names. Half-open [from, to);
        // omit "sports" to cover every sport of the gear's kind.
        { "from": "2018-09-07", "to": null, "sports": ["ride", "virtual_ride"] }
      ]
    }
  ],
  // Written by the converter below, not by hand. "stravaActivityId" and
  // "filename" are the identity keys the matcher prefers; an entry carrying
  // neither has only "time" and the tolerance window to find its activity.
  "assignments": [
    {
      "time": "2015-10-06T09:44:23Z",
      "gear": "Brompton S6R",
      "stravaActivityId": "404639743",
      "filename": "activities/404639743.gpx.gz"
    }
  ]
}
```

Dates are either a `YYYY-MM-DD` day (read as UTC midnight) or a full datetime
carrying an explicit `Z`/offset — a bare local datetime is rejected, because
JavaScript would read it in the running machine's zone and silently shift every
activity by hours. The whole file is validated before anything is written.

A component's `addedAt`/`removedAt` seed its **first install period** — the
import creates one period per component and never a second. A part that came off
and went back on is refitted from the gear's own page afterwards, which opens a
new period rather than reopening the first (see **Gear Tracking** in
`docs/fitness-file-storage.md`).

`scripts/fitness/convertStravaExportToGearImport.ts` builds the `assignments`
half from a Strava export. The export's `activities.csv` records which gear each
activity used against a UTC timestamp, but `components.csv` carries no dates at
all — install and removal dates exist only on Strava's gear pages, so the `gears`
half is hand-authored from those pages and merged in:

```bash
./scripts/fitness/convertStravaExportToGearImport.ts \
  --export-dir ./strava-export --gears ./gears.json --output ./gear-import.json
```

It reports per-gear activity counts and Strava's own distance totals, which
should match what the Strava gear page shows — the cheapest check that the gear
names were transcribed correctly.

> **Note:** `defaultSports` decides which gear future uploads auto-attach to, and
> a sport belongs to one gear at a time — giving it to imported gear takes it
> from whatever holds it now (the script warns when it is about to). A purely
> historical import should leave it empty.
>
> **Note:** the import does not evaluate service reminders, so backfilling years
> of activities sends no alerts. The next real activity on gear whose new total
> already exceeds its threshold fires one — that is the reminder working, not a
> bug.

#### Recovering an import that stored the file but never created the post

When an import failed after saving the file to storage but before creating the
status (an orphaned file — visible in the Files list on Fitness → Files with no matching
post), first run the read-only preflight. It reports **which database** you are
actually connected to and whether the actor, Strava settings/token, stored file,
and same-ride overlap are present:

```bash
NODE_ENV=production ./scripts/fitness/diagnoseFitnessImport.ts \
  --actor-id https://your-domain.tld/users/username \
  --activity-id 123456789 [--activity-id ...] [--skip-token]
```

Then recover. If the Strava activity still exists, `retrigerStravaActivities.ts`
re-fetches it (restoring caption/photos). If it was **deleted from Strava** (the
re-trigger 404s), rebuild the post straight from the already-stored file — no
Strava call — with:

```bash
NODE_ENV=production ./scripts/fitness/importStoredFitnessFile.ts \
  --actor-id https://your-domain.tld/users/username \
  --activity-id 123456789 [--activity-id ...] [--visibility private] [--dry-run]
```

Passing several `--activity-id`s at once groups them by same-ride overlap (≥80%
on start+duration), so one ride recorded as two Strava activities merges into a
single post instead of duplicates. To consolidate existing duplicate posts,
delete them first (deleting a status detaches its files back to orphans), then
re-run with all the activity ids.

To recover all failed or orphaned imports for an actor without re-triggering each activity individually, run `repairFailedFitnessImports.ts`. It re-executes the appropriate background importer directly from stored files:

```bash
NODE_ENV=production ./scripts/fitness/repairFailedFitnessImports.ts \
  --actor-id https://your-domain.tld/users/username \
  [--batch-id <batch-id>] [--visibility private] [--dry-run]
```

Recreated manual-upload posts default to `private`, because a failed upload does not record the visibility it was sent with; pass `--visibility public` (or another value) only when you know that is what the owner wanted. `importStoredFitnessFile.ts` follows the same default, and the import jobs themselves treat an omitted `visibility` as `private`.

> **Important — run these against the right database.** `@next/env` loads
> `.env.local` at higher precedence than `.env.production` **even under**
> `NODE_ENV=production`, so a stray `.env.local` silently points every recovery
> script at your **local** database — which then reports "nothing to do". Move it
> aside for the run (`mv .env.local .env.local.off`, restore it after), and
> confirm the `[1] Database connection` line from `diagnoseFitnessImport.ts`
> shows your production host.

For local archive or one-off activity imports, see the `--help` output from:

```bash
./scripts/fitness/importStravaArchive.ts --help
./scripts/fitness/resumeStravaProcessing.ts --help
./scripts/fitness/runImportStravaActivity.ts --help
```

## Import Remote Status

The `importRemoteStatus.ts` script fetches an arbitrary remote post (by its web URL or ActivityPub URI) and processes it through `createNoteJob`. This persists the status, populates tags and mentions, resolves author profiles, links reply threads, and fans out the post to timelines for local followers and recipients. It refuses a document whose `id` is not on the origin of the URL it was fetched from, whose `attributedTo` is not on the note's own origin, or whose id is a local one — the fetched document is otherwise only the remote server's claim, and the import hands it to `createNoteJob` as verified by its author. Cross-host redirects are not followed, so pass the post's own URL on its home server.

### When to Use

Use this script to recover federated statuses that were dropped due to federation downtime, delivery errors, or network outages (such as missed inbox deliveries).

### Usage

```bash
# Preview what would be imported (dry-run mode)
NODE_ENV=production node scripts/run.cjs scripts/maintenance/importRemoteStatus.ts <statusUrl> --dry-run

# Import and persist the status into the database
NODE_ENV=production node scripts/run.cjs scripts/maintenance/importRemoteStatus.ts <statusUrl>
```

### Examples

```bash
NODE_ENV=production node scripts/run.cjs scripts/maintenance/importRemoteStatus.ts https://mastodon.in.th/@lluu/117228726176772772
```

## Docker Image Verification

The `verifyDockerImages.ts` script verifies both the minimal and full Docker images.

### What it does

1. **Minimal image verification:**
   - Verifies that optional workspace SDKs (`@google-cloud/tasks`, `@upstash/qstash`, `pg`) are completely absent from the runtime image.
   - Exercises native Sharp image processing.
   - Starts the minimal container with local SQLite, polls `/api/v2/instance` for readiness, and validates the response metadata.
2. **Full image verification:**
   - Verifies that optional queue SDKs (`@google-cloud/tasks`, `@upstash/qstash`) and the PostgreSQL client (`pg`) can be loaded and initialized without contacting cloud services.
   - Verifies that the container can connect to and query a local PostgreSQL instance.

### Usage

```bash
# Verify both minimal and full images (builds images if not present)
node scripts/run.cjs scripts/maintenance/verifyDockerImages.ts

# Force rebuild before verification
node scripts/run.cjs scripts/maintenance/verifyDockerImages.ts --build

# Verify specific image tags without rebuilding
node scripts/run.cjs scripts/maintenance/verifyDockerImages.ts \
  --skip-build \
  --minimal-image activities:test-minimal \
  --full-image activities:test-full
```

## Related Documentation

- [Setup Guide](setup.md) — Initial setup and configuration
- [Environment Variables](environment-variables.md) — Complete configuration reference
- [SQLite Setup](sqlite-setup.md) — SQLite-specific setup and backups
- [PostgreSQL Setup](postgresql-setup.md) — PostgreSQL-specific setup and backups

---

## Contributor rules

Read the applicable rules and review checks below before changing this subsystem. The mandatory workflow remains in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

- [Deleting Media a Post Uses](#agents-deleting-media-a-post-uses)
- [Security & Configuration Tips](#agents-security-configuration-tips)
- [Composite Index Column Order on statuses (PostgreSQL 18)](#agents-composite-index-column-order-on-statuses-postgresql-18)
- [Database Compatibility Guidelines](#agents-database-compatibility-guidelines)
- [Review: Uploaded file names](#review-uploaded-file-names)
- [Review: Unique constraints (TOCTOU)](#review-unique-constraints-toctou)
- [Review: Database & migrations](#review-database-migrations)
- [Review: Stored media](#review-stored-media)

### Media Details, EXIF and Gallery Settings

An uploaded image carries optional owner-edited details on its `medias` row: `subjectName`, `subjectScientificName`, `subjectCategory`, `takenAt`, `cameraGearId`, `lensGearId`, `exposure` (JSON text: focal length, aperture, shutter, ISO), the place (`placeName`, `placeLatitude`, `placeLongitude`, `placePrecision`) and `inGallery`. Camera and lens live in `gallery_gears` (unique per actor on `deviceKey`); per-actor behaviour lives in `gallery_settings` (one row per actor, defaults returned when absent).

- **EXIF is read once, at upload, from the original bytes, and no stored copy keeps it.** `readMediaExif` (`lib/services/medias/exif/readMediaExif.ts`) uses `exifr`, never throws, applies `OffsetTimeOriginal`, and treats `0,0` and out-of-range GPS as missing. `exifr` revives `DateTimeOriginal` in the _process's_ timezone, so the wall-clock fields are rebuilt with `Date.UTC` (`toTakenAt`); `takenAt` must not depend on the server's `TZ` (tested under several zones with `withTimeZone`). `buildUploadMediaDetails` (`lib/services/gallery/uploadMediaDetails.ts`) turns it into row details for both the synchronous path (`saveMediaFile`) and the presigned completion (`S3StorageFile`), honouring `galleryDefault` and `defaultPlacePrecision`. Videos skip EXIF but still get `inGallery`.
- **The synchronous path** re-encodes without `keepExif()`. **The presigned path** receives the client's bytes at a public key, so completion reads the EXIF first and then re-encodes image originals in their declared format (JPEG at quality 95, or PNG; orientation applied, no resize) into a **new key** beside the client's object (`_stripPresignedImageMetadata`). The client's object is never overwritten while the row is pending: `markMediaUploadVerified` swaps the row to the stripped key (`originalPath`) and size (`originalBytes`) in the same update that marks it verified, and the client's presign key is recorded in `originalMetaData.upload.clientPath` (the 600-second presigned PUT URL stays valid after the swap, so a re-PUT can recreate an untracked object there; `deleteMediaForAccount` returns that key beside the original and thumbnail so every media delete path removes it too), and only then is the unstripped object deleted (a failure to delete it is logged as an error, since `GET /api/v1/files/...` serves any media key). `markMediaUploadVerified` is a read-check-write in one transaction, with the row locked `FOR UPDATE` on PostgreSQL (SQLite serialises transactions on its one connection), and the update itself is conditional on `upload.state = 'pending'` (`->>` on PostgreSQL, `json_extract` on SQLite): only the call whose update changed the row makes the transition and moves the account's media usage counter by the size difference, and it reports `transitioned: true`; a repeated or concurrent completion gets the verified media back with `transitioned: false`, deletes its own stripped copy and returns that media without redoing the decoration. A transient failure anywhere before the swap (including the verify update itself) deletes only that attempt's copy and leaves the upload pending with the client's bytes intact, so a retry validates and strips them again with their EXIF. A validation failure re-reads the row first and never deletes one a concurrent completion has already verified (whose cleanup is what made the object "missing"). A re-encode that fails refuses the upload and removes its object and row (fail closed). The completed media's `url` is the stripped key, not the one in the presign response, so clients must use the completion response. This runs for images of any size (sharp reads the temp file; only the EXIF read and the blurhash/alt-text analysis are capped at `PRESIGNED_ANALYSIS_MAX_BYTES`). Details are built before those size and analysis gates and are passed to `markMediaUploadVerified`, which writes them (through the same column mapping as `createMedia`/`updateMedia`) in that same conditional pending → verified update, so they commit with the swap or not at all — the client's original, the only source of the EXIF, is deleted right after, so a later separate write that failed would lose them for good. They therefore survive an analysis failure or a failed decoration `updateMedia`, and an owner's `galleryDefault` applies to a 200 MB video as well. Only blurhash, focus, alt text and a video's poster are written afterwards.
- **Gear is resolved by `resolveGalleryGear` (`lib/services/gallery/galleryGear.ts`)** from a normalised `camera:<make>|<model>` / `lens:<lensModel>` key; it is race-safe, reuses an existing row and never edits one. Because the key comes from client-controlled EXIF strings, creation goes through `createGalleryGearWithinLimit` with the same 500-row cap as the manual route: at the cap an upload gets no gear link (logged at `info`) rather than a new row, while gear the actor already holds still resolves. `gallery_gears` is soft-deleted but its `(actorId, deviceKey)` unique index covers deleted rows while the device-key lookup skips them, so **any delete path must null `deviceKey` in the same update that sets `deletedAt`** (as `fitnessGear.ts` does), or the next upload from that camera could neither find nor re-create its gear. `POST /api/v1/gallery/gears` returns the existing row (200) for the same kind and case-insensitive, whitespace-collapsed name, and answers 422 `{ "error": "Too many gear items" }` past 500 non-deleted rows per actor. Both checks and the insert run in `createGalleryGearWithinLimit`, one transaction serialised on the actor row (`FOR UPDATE` on PostgreSQL, as `createCollection` does; SQLite's single writer already serialises), so concurrent submits of one name add one row and concurrent creates cannot overshoot the cap — there is no name index to enforce it, since manual gear has no `deviceKey`. A client-supplied `camera_gear_id` / `lens_gear_id` must belong to the media's actor and be of the right kind, else 422.
- **Public details never leak more than the owner chose.** `GET /api/v1/gallery/media/:mediaId/details` answers only for media attached to a status the viewer may read (404 otherwise), and only an attachment written by an actor on the media owner's account counts (`getMediaWithAttachedStatusIds`): `attachments.mediaId` is a bare pointer any actor can write, so another account's public post pointing at the id must not unlock the details. `createNote` likewise writes `mediaId` only for an id `resolveAttachmentMediaMetadata` resolved to a row on the author's account; the outbox takes attachment ids from the client, and an unowned one is stored without a media link. `placePrecision` `exact` returns coordinates, `area` snaps them to a 0.05° grid, `country` returns the country's name from `placeCountryCode` (the owner's own name only when there is no usable code, and never a geocoded name), unset returns the owner's own name only (a geocoded name with no precision is not shown at all: the owner never chose to publish anything), `hidden` returns nothing, and a threatened or not-yet-cleared species overrides every precision with no place at all (see "Smart subjects" below); gear and exposure are returned only when `showGear` is on (`lib/services/gallery/publicMediaDetails.ts`).
- **Owner routes**: `GET`/`PUT`/`PATCH /api/v1/media/:id` return and accept the details (snake_case); `POST /api/v1/media/:id/describe` returns generated alt text without saving it; `POST /api/v1/media/:id/subject-suggestions` returns (or, with `refresh`, re-runs) the vision model's subject candidates, 30 runs per actor per hour, and answers `409 { error }` without reading the image when the owner's `subjectSuggestionMode` is `off` (enforced on the server, so a stale tab or another client never sends the photo to the model); a candidate named only by a common name gets a GBIF key only when the job itself would confirm that name (a complete, exhaustive search with exactly one exact hit at species rank in the candidate's kingdom), and a match from another kingdom never replaces the model's category; `POST /api/v1/media/:id/lookups` re-queues the place and subject lookups that have not finished (the dialog's Retry), 20 per actor per hour, or only one of them with `{ "kind": "subject" }` or `{ "kind": "place" }` (the dialog sends the kind of the Retry pressed); `GET /api/v1/gallery/taxa?q=` searches GBIF for the species picker, 60 per actor per minute; `GET`/`POST /api/v1/gallery/gears`, `GET /api/v1/gallery/taxa` and `GET`/`PUT /api/v1/gallery/settings` are session-authenticated, the media routes take OAuth or the session.
- **Settings** (`gallery_settings`, `GET`/`PUT /api/v1/gallery/settings`): `autoDescribe`, `allowEmptyDescription`, `subjectHashtags`, `galleryDefault`, `defaultPlacePrecision`, `showGear`, `mapPublic`, `lifeListPublic`, `hiddenLocations`, `hideThreatenedPlaces` (default on), `subjectSuggestionMode` (`model` or `off`; `classifier` is reserved and refused) and `subjectConfidenceThreshold` (50 to 95 in steps of 5, default 70). The response also reports what this server can do (`subjectSuggestionsAvailable`, `subjectModel`, `speciesLookupsAvailable`, `placeLookupsAvailable`). Settings → Media exposes `autoDescribe`, `allowEmptyDescription`, `subjectHashtags` and the subject suggestion settings, with links to Gallery → Privacy and Gallery → Gear; `defaultPlacePrecision`, `hideThreatenedPlaces`, `showGear`, `mapPublic`, `lifeListPublic` and `hiddenLocations` live on Gallery → Privacy (`/gallery/privacy`). `defaultPlacePrecision` defaults to `hidden` (the privacy-safe default, closest to Mastodon stripping EXIF): a GPS upload stores its coordinates for the owner but publishes no place until the owner picks a precision on the photo or changes the default.
  - **Subject hashtags** (`appendSubjectHashtags`, called from `createNote`) append a de-duplicated PascalCase tag per attached subject before hashtags are extracted, when `subjectHashtags` is on.
  - **`autoDescribe`** gates automatic alt text on upload in both the synchronous (`handleSyncMediaUpload`) and the presigned paths, even when the instance has an alt text service configured.
  - **`allowEmptyDescription`** (default on): when `false`, the composer requires a description on every attached media before it will post (`post-box.tsx`).
- **Gallery section** (`/gallery`, owner-only pages that call `lib/services/gallery/galleryQueries.ts` with `OWNER_GALLERY_AUDIENCE`; no migration).
  - **Routes**: `GET /api/v1/accounts/:id/gallery/{media,subjects,life-list,map}` are CORS `GET`s behind `OptionalOAuthGuard`; a missing or remote actor is 404. `media` takes `max_id` (digits), `limit` (1-60, default 30), `subject` (a `toSubjectKey` key), `category` and `show` (`all`, `in_gallery` or `hidden`, validated with zod; owner only, ignored for anyone else, who always get the in-gallery set); `gear_id` is owner-only (422 for anyone else, an empty page for an unknown id). The map accepts no bounding box or proximity parameter. If one is ever added, filter on the disclosed coordinates, never the stored ones, or bisection reveals the exact point. `map?preview=public` (owner) runs the logged-out query itself, not the owner rows re-projected; any other `preview` is 422.
  - **Gallery scope**: a media row is in the gallery when `medias.inGallery` is set and some attachment of the owner's, with a `statusId` the audience may read (`buildActorVisibleStatusIdsQuery`), points at it. This holds for the owner too, so unposted uploads never appear, and deleting a post drops its media out. **All media** (`/gallery/media`, formerly Recent; `/gallery/recent` permanently redirects and keeps the query string) orders by `medias.id DESC` with a `max_id` cursor, not by `takenAt`, which holds mixed storage types on SQLite. Its owner-only **Show** filter (`show=all|in_gallery|hidden`, `GalleryShow` in `lib/types/database/gallery.ts`) widens that scope inside `buildGalleryMediaScope`: `all` drops the `inGallery` condition, `hidden` flips it, `in_gallery` (the default for every other caller and audience) keeps it. Only the owner audience can widen it, so a visitor's `show` is dropped before it reaches SQL. Owner items carry `inGallery: boolean` (never present for visitors), which draws the tile's "Hidden" badge.
  - **Index cap**: Subjects and Life list group one index read in JS by `toSubjectKey`, capped at `GALLERY_INDEX_CAP` (5000) rows, as does the Map's point list; those responses carry `truncated: true` past it. Subject and category pages read the same index in windows of that size with the `maxId` cursor pushed into SQL (`medias.id < maxId`), so they reach every photo and carry no `truncated` flag. A page request scans at most `MAX_INDEX_WINDOWS` (3) windows; if the page is still short it returns what it found with `nextMaxId` set to the last scanned id, and `GalleryPagedGrid` follows that cursor (twice on its own, then "Load more").
  - **SQLite `mediaId` comparison**: the gallery scope compares `attachments.mediaId` with `CAST(medias.id AS TEXT)` on SQLite only (`mediaIdRef`), because the varchar column otherwise cannot use `attachments_mediaId_idx`. `createAttachment` therefore writes the canonical `String(id)`.
  - **Privacy per view** (non-owner means `audience.kind === 'viewer'`): every item is gallery-scope media from an attachment the viewer may read, with `place` from `getPublicPlace` and gear and exposure only when `showGear` is on (gear ids are never sent); Subjects and Life list are built from the viewer-scoped index only, so a subject that exists only on hidden posts is absent; Life list and Map answer 404 unless `lifeListPublic` / `mapPublic`; the Map lists only `area` (snapped to the 0.05° grid) and `exact` points outside every hidden location, ordered by media id; the profile Gallery tab uses the viewer-scoped `getActorHasGalleryMedia` and offers only the subviews the settings allow. The owner sees everything, with `publicState` on map points marking what the public gets.
  - **Hidden locations** are `{ latitude, longitude, hideRadiusMeters }` (at most 50, parsed by `parseGalleryHiddenLocations`; radii snap up to 50, 100, 200, 500 or 1000, above 1000 is 422). A photo inside one gets `place: null` for every non-owner, which now includes `GET /api/v1/gallery/media/:mediaId/details`.
  - **Gear**: `GET /api/v1/gallery/gears?include=usage` adds `photoCount` (gallery media only, photos and videos), `videoCount` (the videos among them), `countryCount` (distinct stored `placeCountryCode`s over the same media, owner-only so unprojected; null when none has a code, which the page shows as a dash) and `firstUsedAt` and `lastUsedAt` (all the owner's posted media, `takenAt` else upload time, reduced in JS). `GET`/`PATCH`/`DELETE /api/v1/gallery/gears/:id` and `POST .../:id/retire` are session-only and 404 on a missing or foreign id. Delete soft-deletes, sets `deviceKey = null` in the same update so the camera can be re-created, and nulls `cameraGearId` / `lensGearId` on that actor's media only. Gear lists are not public.
- **Public albums** (`/@user@domain/albums/[id]`, `GET /api/v1/accounts/:id/gallery/albums[/:albumId]`; no migration). Everything is read through the same `GalleryAudience` as the rest of the gallery; `resolveGalleryAudience` is the one place a session becomes an audience for the routes and the page. Keep these properties when changing it: the Open Graph tags come from `getGalleryAlbumShare`, which takes no viewer; a visitor response never carries `coverMediaId`, a non-zero `hiddenPlaceCount` or any IUCN/lookup field, nor the album's stored `createdAt`/`updatedAt` (they move with photos the viewer cannot see; `summarize` in `lib/database/sql/galleryAlbums.ts` replaces them with the visible items' first and latest added-at, and the visitor list order uses that) (the owner path is the only one that reads `getGalleryAlbumPlaceIndexes`); an album a viewer cannot open is the same 404 whether private, missing, foreign, empty or only holding photos from posts they cannot read, and the route answers it before it looks at the query. The read limit (300 per viewer per minute, in process, `tryAlbumRead`) keys a logged-out caller by `getTrustedClientIp` (`lib/utils/getTrustedClientIp.ts`, shared with `POST /api/v1/apps`), which is undefined unless `ACTIVITIES_TRUST_PROXY_IP_HEADERS` is on, in which case the read is not counted. An unavailable album page is HTTP 200 with `noindex` because of `[actor]/loading.tsx` streaming, like a missing profile. Tests: the visibility matrix lives in `galleryAlbumVisitor.test.ts` on a shared fixture (`galleryAlbumMatrixFixtures.ts`: owner `test6`; follower, stranger and blocked accounts; one photo per post visibility, a deleted post, a photo outside the gallery, and one per place rule); the routes and the page test run the same fixture. Extend the fixture, not each test.
- **Smart subjects and place names** (columns on `medias`, owned by the lookups; none is writable through `createMedia`/`updateMedia`).
  - **Columns.** `subjectTaxonKey` (GBIF usage key, also writable by the owner's picker), `subjectTaxonPath` (kingdom to family, stored at resolve time so a public read never looks anything up), `subjectIucnCategory`, `subjectLookupStatus` (`pending`, `resolved`, `failed`, `disabled`, and `no-match`, which only earlier builds wrote and which no longer clears a place; null is "never attempted or not species-like"), `subjectLookupAt`, `subjectSuggestions` (owner-only JSON, at most 16 KiB), `placeCountryCode`, `placeNameSource` (`owner` or `geocoder`; null is legacy and counts as owner), `placeLookupStatus` and `placeLookupAt`. Changing the subject resets the IUCN category, path and status (to `pending` when species-like) in the same UPDATE, and clears a taxon key the edit did not send; setting or changing the coordinates (an upload with GPS included) clears the country code and sets the place status to `pending` with `placeLookupAt`, because the lookup is queued right after the write (null when the point was cleared); a typed `place_name` marks the name as the owner's, so a geocoded name never overwrites it.
  - **Suggestions are never decisions.** The vision model's candidates are stored as owner-only suggestions (`POST /api/v1/media/:id/subject-suggestions`, on request, not as a job) and the `subject*` columns change only when the owner saves. Posting without review sets no subject and adds no hashtag, so every saved subject is owner-confirmed. Mastodon API clients get no suggestions.
  - **A threatened species never shows a place publicly.** "Threatened" is IUCN CR, EN or VU. `isPlaceWithheldForThreat` (`lib/services/gallery/threatenedSpecies.ts`, one rule behind `getPublicPlace`) withholds the place from every non-owner when `hideThreatenedPlaces` is on and the subject is species-like (a taxon key, a scientific name, or a common name in a living category) unless the lookup cleared it, and the only thing that clears it is **one species confirmed as not threatened**: `resolved` with a category outside CR/EN/VU. `no-match` never clears a species-like subject (a name GBIF cannot place, or places among several species, may still be a threatened one), and `resolved` with no category (a genus or family) does not either. **What the job stores is decided in one place**, `decideSubjectLookup` (`lib/services/gallery/lookups/subjectDecision.ts`), from the evidence the job gathered, and it is fail-closed by construction: a place is shown only when the subject resolves to exactly one taxon at species rank or lower whose Red List category was read (GBIF's 204 is `NE`) and is outside CR/EN/VU, each field checked; everything else (an unknown shape, a null taxon, a key GBIF answers 404 for, any branch the code does not know) is `failed`, or `resolved` with CR, EN or VU, or `resolved` with no category. It never writes `no-match`. The allow-list: (1) a readable `species/{key}` record at species rank or lower for the stored key, or for the key of a confident `EXACT`/`FUZZY` match on the scientific name that itself named a species. **A stored key is checked against the subject's own names**, because any key can arrive (an API client's `subject_taxon_key`, a stale picker, an old suggestion chip): with a scientific name the record's canonical or full scientific name must be it; with only a common name one of the record's vernacular names must be it exactly (the record's own, or a backbone search that lists the key as a result with that name); a living category must name the record's kingdom and, when GBIF files the record under a category, be that category. A key whose readable record disagrees is set aside and the subject's names are asked instead, under their own rules ((1)'s confident match or (2), never (3)), so a synonym or FUZZY name the job matched once (it stores the accepted key but keeps the owner's own name) resolves again after a rename or a category edit that kept the key, while a giant panda saved with the key of the tree _Panda oleosa_ still ends up `failed` and hidden; a key-only subject with no names is checked on its record alone, and fails on any disagreement; (2) a common-name `species/search` that is **exhaustive** (GBIF's `endOfRecords: true`), every result readable, with **exactly one** result naming the subject exactly across **all** its vernacular names (not just the 20 kept for display), whose record is at species rank or lower and in the kingdom the subject's category names (`Animalia` for the animal categories, `Plantae`, `Fungi`); (3) an unhinted name GBIF placed in a species without a confident match (a `HIGHERRANK` answer, or one below the confidence bar, such as "Pongo abelii xyz" placed in the Sumatran orangutan) whose readable category is LC, NT, DD or NE, stored `resolved` with that category but no taxon key or path (CR, EN or VU is stored the same way and stays hidden; EX, EW, or a name placed only in a genus is `failed`; never for a subject whose stored key was set aside, because GBIF has stopped knowing it or its record disagrees with the names). Everything else stays hidden: GBIF's `NONE`; a search whose page is not the last (live, "Tiger" has 1556 results and _Panthera tigris_ is not in the first 400), whose results could not all be read, with no exact hit, or with several ("Pangolin" names seven _Manis_ species, "Vaquita" a beetle, an orchid and a ladybird but not the porpoise); a hit in another kingdom ("Panda" filed as a mammal finds only the tree _Panda oleosa_); and a genus or family, which is stored `resolved` with its key and path but **no category**, because GBIF never assesses a group and its `NE` says nothing of its species (every _Pongo_ is CR). The owner sees "We couldn't confirm the species, so the place stays hidden. Pick the species to show it." with the species picker (and Retry for `failed`). The category's kingdom hint is only trusted when it yields a confident match: any other hinted answer is asked again without the hint, because a wrong category ("Panthera tigris" filed as a plant) makes GBIF answer a kingdom, or `NONE`, for a name it matches exactly. `resolveMediaSubjectJob.property.test.ts` runs the real job and client over thousands of random combinations of odd GBIF answers and checks a place is never public off this list. A key GBIF just named in a match or search that `species/{key}` then answers 404 for (the two services on different backbones) is `failed`, as is a stored key with no name left to try; the owner's Retry asks GBIF about such a key again rather than waiting out its cached miss. **It fails closed**: `pending`, `failed`, `disabled`, never-attempted, or `resolved` with no category are all withheld, so a server with lookups off or unreachable hides every species photo's place while the switch is on, and media uploaded before the lookups existed stays hidden until `backfillGalleryLookups.ts` has run (see "Gallery Lookup Backfill"). It overrides the precision and hidden locations alike, and the map drops the point (the owner sees it with `publicState: 'threatened-species'`, checked before `in-hidden-location`, and counted in "not on the public map"). `toPublicPlaceInput(row)` replaces the old map-row details spread so a new rule input cannot silently read as null on map rows; its guard test iterates every `PublicPlaceInput` key.
  - **What the IUCN data discloses.** The category and lookup status are owner-only and only drive the rule; they are never in a public entity. The taxon key and path are public species facts and are sent.
  - **`country` precision tightened.** A public `country` place is now the country name from `placeCountryCode` when the code is known. Without a usable code it falls back to the stored `placeName` only when the owner wrote it (`placeNameSource` `owner`, or a legacy null); a geocoded name is never shown for `country`, since it names the town and without a code there is no telling which part is the country. So a geocoded "Pak Chong, Thailand" cannot leak through `country`. A public place carries `countryCode` whenever it has a precision; a place with no precision (an owner's own name such as "Home", shown on its own) never does, since the code is the geocoder's reading of a point the owner never published, so it adds nothing to the public country counts either.
  - **An unreadable provider answer fails closed.** Each GBIF call names the only non-200 answer it reads as "nothing here": a 204 from `iucnRedListCategory` is "not assessed" (`NE`, which clears the place of a confirmed species), and a 404 with GBIF's own JSON error from `species/{key}` is an unknown key (the job then tries the subject's names). Any other non-200, including every 404 from `species/match` or `species/search` (which answer 200 for a real no-match) and an HTML 404 from a wrong or retired endpoint, is an `http` failure, recorded `failed`; a 200 whose category the client cannot read (no known `code`, nor a known long `category` name such as `ENDANGERED`), a `species/{key}` record or `species/match` answer in a shape it does not know, or a search whose results all fail to read is a `parse` failure, so the subject is recorded `failed` and the place stays hidden. Reading a changed shape as "not threatened" or "no match" would publish a threatened species' place. Nominatim's `{"error": …}` is a cell with no name; any other answer without an `address` is a failure too.
  - **Lookups after an edit are never dropped as duplicates.** Each publish that follows a reset (a `PUT`) or a Retry carries a random part in its job id, so editing back to an earlier subject or point (A, B, A) queues a new job instead of colliding with the first one, which the database queue keeps for days and QStash deduplicates. Only the upload paths keep a purely deterministic id, so a doubled verify step collapses. A subject or place reset to `pending` records when (`subjectLookupAt`, `placeLookupAt`), and the owner entity's `subject.lookupStale` and `place.lookupStale` turn true after two minutes (`STALE_SUBJECT_LOOKUP_MS`, `STALE_PLACE_LOOKUP_MS` in `lib/services/medias/lookupStaleness.ts`), which is when the dialog offers Retry beside "Checking IUCN status…" or "Looking up the place name…". Until then the dialog reads the media again, up to four times, three seconds apart, with a fresh budget for each new pending state (each Retry, and each re-queue, stamps a new `lookupAt`) and carrying on past a failed read; and an open dialog marks a lookup stale itself once two minutes have passed since its `lookupAt` (sent as `subject.lookupAt` and `place.lookupAt`), so Retry shows without reopening it. The subject job's compare-and-set includes the category, which is its kingdom hint, so a result worked out under an older category is dropped. Coordinates with a null place status (saved before the lookups existed) get a Retry too. A `PUT` that re-sends the stored subject queues no lookup, so it cannot overwrite a finished result. A Retry marks the lookups it re-queues `pending`, re-queues only those that have not finished (and only the kind whose Retry was pressed; a place `no-match` is finished), and tells each job to skip the failure the lookup cache remembers, so it asks the provider again at once (an open circuit still fails fast).
  - **Countries are counted from projected places only.** `countryCount`/`countryCodes` (Subjects "Places", the map summary, a subject's "Where", the gear page's "Places" for the owner) and the life list's `firstPlaceName` are computed from the viewer-scoped, public-projected places, so a withheld place adds no country and a count cannot reveal a hidden location. The owner's own counts use stored codes. A count is `null` (the cell is omitted, never "0") when no visible place has a code, which is also the state with place lookups off.
  - **Place names are looked up, not guessed.** Reverse geocoding fills `placeName` (source `geocoder`, "From file" in the dialog) and `placeCountryCode`; a cell near a border can get the neighbouring country, which is accepted. The details Place section credits "Place names © OpenStreetMap contributors", the species picker "Names from the GBIF Backbone Taxonomy", and the owner-only status "IUCN Red List status via GBIF". The outbound side, jobs and cache are in [architecture.md](architecture.md#gallery-lookup-jobs).
  - **Scientific hashtags.** With `subjectHashtags` on, a `#GenusSpecies` tag (`#AlcedoAtthis`) is appended next to `#CommonKingfisher`, de-duplicated the same way. Only a well-formed binomial (capitalised genus, lower-case epithet, no hybrid mark or `sp.`) gets one, and a subspecies shares its species' tag; the rule lives once in `lib/utils/text/subjectHashtagRules.ts`.
  - **Degradation.** No alt-text endpoint (or `ACTIVITIES_GALLERY_SUBJECTS=off`): no suggestions, the dialog is manual. GBIF off or unreachable: suggestions come back unchecked, species search says it is unavailable, and species places stay hidden (the privacy page says so). Nominatim off or unreachable: no automatic place name, countries are omitted. Neither affects uploads, posting or the gallery.
- **Edit in Gallery**: on the owner's own Gallery grids, and on the signed-in actor's own posts anywhere the photo viewer opens (the timelines, a profile's posts, a thread and the status page, through `OwnPostMediasModal`), the viewer shows an **Edit** button beside Details (`MediasModal`'s `onEdit`, given only when `albumsOwnerId` names the signed-in actor; `canEdit` limits it to photos with a media id whose `actorId` is that actor, so never another account's or a remote post's photos). Select mode's bar has **Edit details**, capped at 40 selected photos (`MAX_EDIT_DETAILS_PHOTOS`: it reads each photo's details and opens one dialog). Both open `GalleryEditDetailsDialog`, the composer's `MediaDetailsDialog` with `context="gallery"` (titled "Edit details", no "1 of 1" counter for one photo), loaded with the owner's `getMedia` details (the opening photo first, four at a time) and the gallery settings. Subject, place, gear and Show in my gallery are saved by `PUT /api/v1/media/:id` as in the composer. A posted photo's alt text is not: the dialog sends it as an edit of the post, `PUT /api/v1/statuses/:id` with `media_attributes` only, which records the status history and federates an Update (Mastodon behaviour, noted under the field as "Changing alt text edits the post, like Mastodon. Followers see it as edited.", with an **Open post** link in the footer). Alt text for several photos of one post goes out as one edit with every changed `media_attributes` entry, after the media rows are saved, so followers get one Update. A `media_attributes`-only edit changes the alt text of only the photos it describes: the others keep what the post already publishes, not their media row's description (the two can differ, as the composer stores the alt text on the attachment). That route's per-attachment `description` cap is `MAX_MEDIA_DESCRIPTION_LENGTH`, the same as `PUT /api/v1/media/:id`. If the details save but the post edit fails, the dialog keeps the failed alt text for a retry and still reports the details that saved; a retry is applied on top of the tile the first save produced (`GalleryEditDetailsDialog` keeps it). After a save the grid swaps in the edited tiles (`applySavedToItem`); a tile that leaves the list under the current Show filter (a grid with no `show` is the gallery list) is dropped only when the viewer closes (or at once from Select mode, which also forgets its pick), so the viewer keeps its place. All media reuses the server-rendered first page only until a filter is changed. Albums hold only photos shown in the gallery: in All media, Add to album is off while the selection holds only hidden photos, and a mixed selection adds the photos in the gallery and says how many hidden ones were skipped (`describeHiddenSkipped`); a new album from a selection starts from the photos in the gallery only.
- **Viewer**: the lightbox (`MediasModal`) fetches `GET /api/v1/gallery/media/:mediaId/details` for the open media and renders it read-only through `MediaDetailsPanel`, in the viewer's **Details** overlay (subject with its taxonomy path, taken-at, camera and lens, exposure, place), which is hidden on every open and also holds the alt text and the owner's albums pill, while the photo keeps one viewport-based size cap whatever it carries. The panel shows exactly what the privacy-trimmed endpoint returned and nothing when it answers 404. It adds "<category> · confirmed by <owner>" only where the modal is told the owner (`ownerName`, passed from the status page), which is always true of a saved subject because suggestions are never applied without the owner, and "#<ScientificName> on the fediverse" linking to `/tags/<tag>`. It has no "More in <owner>'s gallery" link: the profile's tabs are client state with no URL to deep link to. The tag is built by `toScientificHashtag` (`lib/utils/text/subjectHashtagRules.ts`), the same pure function the server uses when it appends the tag to a post, so the tag shown is always the tag posts get.
- Covered by the tests beside each module: `lib/database/sql/{gallery,galleryMedia,galleryMediaQueryPlan,galleryAlbums,galleryAlbumSuggestions,mediaDetails}.test.ts`, `lib/services/gallery/{galleryQueries,galleryProjection,hiddenLocations,galleryGearUsage,galleryAlbumQueries,galleryAlbumVisitor,galleryAlbumRouteSupport,galleryAlbumUrls,galleryAlbumSuggestions,galleryAlbumSuggestions.windows,galleryAlbumSuggestionGroups,galleryAlbumSuggestionTitles}.test.ts`, `lib/utils/getTrustedClientIp.test.ts`, `app/(timeline)/[actor]/albums/**/*.test.{ts,tsx}`, `lib/components/gallery/*.test.tsx`, `app/(timeline)/gallery/{albums,media,recent}/**/*.test.{ts,tsx}`, `app/api/v1/media/[id]/albums/route.test.ts`, `app/api/v1/gallery/**/route.test.ts` (including `app/api/v1/gallery/albums/**`) and `app/api/v1/accounts/[id]/gallery/**/route.test.ts`. `galleryAlbums.test.ts`, `galleryAlbumQueries.test.ts` and `galleryAlbumVisitor.test.ts` (the full viewer by post-visibility by place matrix: owner, follower, stranger, blocked and logged out against public, unlisted, followers-only and direct posts, a deleted post and a photo outside the gallery, and each place rule; its fixture is `galleryAlbumMatrixFixtures.ts`, shared with the route and page tests) also run against PostgreSQL in CI (they pin the actor-lock caps and cover races, which SQLite's single writer cannot show), and so do the suggestions' store and service tests, both named `galleryAlbumSuggestions.test.ts` (they pin the day and trip grouping on both timestamp types).

<a id="agents-deleting-media-a-post-uses"></a>

### Deleting Media a Post Uses

- **The two media DELETE routes disagree on purpose, and neither is a bug.**
  `DELETE /api/v1/media/:id` is Mastodon-compatible and refuses media a posted
  status uses (`deleteMediaForAccount` answers `in-use` → 422).
  `DELETE /api/v1/accounts/media/:mediaId`, behind the Settings → Media
  button, deliberately allows it, promising "Posts containing this media will
  show a placeholder image". Do not "reconcile" them by making the settings
  route 422 — that revokes a shipped capability. **The promise holds only for an
  attachment that already carries a BlurHash**: `lib/components/posts/media.tsx`
  gates the `<img>` at `opacity-0` until `onLoad` (which a 404 never fires) ONLY
  inside `if (blurhash)`; a falsy one falls through to a bare `<img>`, so a 404
  is a broken-image icon, and once the bytes are gone nothing can compute one.
  Do not dismiss a broken-image report as handled by design.
- **Deleting a `medias` row therefore leaves `attachments.mediaId` pointing at a
  row that is gone, and clearing it would be a regression, not a cleanup.** A
  NULL `mediaId` is how a FEDERATED attachment is stored, and
  `isReplaceableMediaAttachment` (`lib/database/sql/status.ts`) reads exactly
  that to decide an attachment is not the owner's to replace. Nulling it would
  turn a broken attachment the author can still remove by editing the post into
  one that never can be, and destroy the only record that it was backed by local
  media; `lib/database/sql/statusWrite.test.ts` → `clears only editable media while
preserving legacy and fitness attachments` pins the surviving-null behaviour.
  Deleting the attachment row instead removes the promised placeholder and
  silently rewrites a published status whose federated copies keep it.
- **Deleting a `medias` row also takes it out of every gallery album.** The
  `gallery_album_items` rows cascade on PostgreSQL, but an album's
  `coverMediaId` is a plain column with no foreign key, and SQLite may run
  without foreign keys, so `deleteMedia` and `deleteMediaForAccount` call
  `removeMediaFromGalleryAlbums` (`lib/database/sql/galleryAlbumCleanup.ts`)
  inside their own transaction, and the actor delete (`deleteActorData`) removes
  the actor's `gallery_album_items` and `gallery_albums` before their `medias`.
  **Lock order matters:** those two media paths take the owner's actor-row lock
  (`lockGalleryAlbumActor`) first, then clear the album rows, then delete the
  `medias` row, the same order every album write uses (`createGalleryAlbumWithinLimit`,
  `addGalleryAlbumItems`, `updateGalleryAlbum`, `removeGalleryAlbumItems`,
  `deleteGalleryAlbum`). Deleting the media row first and locking afterwards
  can deadlock against a concurrent remove, and skipping the lock lets a cover
  set a moment earlier outlive its photo. `galleryAlbums.test.ts` pins the
  media and actor-delete cleanup on both backends (the actor delete with
  SQLite's foreign keys switched off) and the races on PostgreSQL.

<a id="agents-security-configuration-tips"></a>

### Security & Configuration Tips

- Store secrets and instance settings in environment variables; avoid committing secrets.
- Review `docs/setup.md` and the database setup guides before changing auth, host, or database settings.
- The full environment-variable catalog lives in `.env.example` (annotated) and `docs/environment-variables.md` — consult both before adding a new `ACTIVITIES_*` variable in `lib/config/`.

#### Uploaded file names are untrusted input

- **In the upload storage drivers (`lib/services/medias/`, `lib/services/fitness-files/`), never join, `extname`, or persist a supplied file name directly — put it through `@/lib/services/medias/fileName` first.** `File.name` and the presigned flows' `fileName` field are plain client-controlled strings: only a browser multipart upload is guaranteed to send a bare basename. Every non-browser Mastodon client (`POST /api/v1/media`, `POST /api/v2/media`, `POST /api/v1/medias/presigned`) puts whatever it likes there, and so do the fitness uploads (`POST /api/v1/fitness-files`, `POST /api/v1/fitness/import`, `POST /api/v1/fitness/strava/archive`, `POST /api/v1/fitness/strava/archive/presigned`). The module lives under `medias/` and is shared, the same way `medias/quota` already is. Apply the same treatment to any new code that accepts an uploaded name.
- `sanitizeStoredFileName` reduces a name to one inert path segment (cuts at the last `/` **or** `\`, drops control, C1, bidi and invisible-spacing characters, rejects `.`/`..`, caps it at 200 bytes so it fits both `varchar(255)` and a filesystem name). Use it for anything persisted or handed to another system — the stored name is federated and becomes the attachment's `name`/alt text on other instances, so bidi overrides there are a display-spoofing vector, and both `medias.originalFileName` and `fitness_files.fileName` are rendered back to users. The cap is not only cosmetic: those columns are `varchar(255)`, so an unbounded name is an insert failure on PostgreSQL. It deliberately keeps U+200C/U+200D, which Persian and Indic spelling and emoji sequences need.
- `createMediaTempFilePath` is the only sanctioned way to build a temp path from a supplied name. `path.join` resolves `..`, so `join(tmpdir(), randomHex + file.name)` escaped `tmpdir()` given three or more `..` (the first is absorbed by the prefix's own segment). With fewer, the name instead cancels the prefix out and lands on a **predictable** `<tmpdir>/<name>`, so one upload can overwrite another's temp file. The helper adds the separator and asserts the result's parent is still `tmpdir()`.
- **A video's preview frame is extracted through `extractVideoPreviewFrame` (`lib/services/medias/videoPreview.ts`), which both storage drivers share, and on the synchronous `saveFile` path it runs _before_ the video is stored — never after.** `extractVideoImage` rejects whenever ffmpeg finds no decodable frame, and a stored file with no `medias` row is unreachable by everything except `scripts/maintenance/cleanupMediaStorage.ts`, so extracting from the already-stored file orphaned it on every failure. The step lives in one module precisely because the two drivers are edited one at a time: the local driver had this gap for as long as both existed. The presigned completion path extracts from the object it has downloaded, generates and persists a thumbnail image if possible, and catches the failure because the media row and object are already committed (see **Video preview frames and automated alt text**).
- **The temp copy that ffmpeg decodes carries no part of the supplied name.** ffmpeg picks its demuxer from the path as well as from the bytes, and the `image2`/`mjpeg` demuxers beat content probing for an image extension paired with a `%0Nd` number pattern or a `*` glob — so a perfectly good H.264 mp4 uploaded as `IMG_%04d.jpg` sent ffmpeg hunting for a numbered image sequence and answered 500 for a file the instance can store. The path still comes from `createMediaTempFilePath`, so it keeps the random prefix and the `tmpdir()` assertion, but the name handed to it is the server-derived `video<ext>` from `getStoredMediaExtension` — which makes that helper's sanitizer a second line of defence here rather than the only one. Validate the container **first**, too: `MediaValidationError` is the caller's 422, and deciding it from the probe alone is what keeps an audio-only mp4 — a voice memo the browser labels `video/mp4` — from spawning ffmpeg and coming back as a logged 500 the client will retry.
- `getStoredMediaExtension(contentType, fileName)` derives a generated path's extension from the **validated content type**, not the name. `extname('clip.mp4/../../evil.html')` is `.html`, which on the local driver became the stored filename and made `/api/v1/files/…` serve an mp4/HTML polyglot as `text/html` on the instance origin; a 300-character extension produces a local filename no filesystem accepts. It falls back to the name's extension only for content types outside the map — which the upload routes already reject — and then only for an allowlisted media extension. It also fixes the case-sensitive `endsWith('.mov')` check that stored `MOVIE.MOV` as `.MOV`.
- **Every entry of `ACCEPTED_FILE_TYPES` must have a mapping in `EXTENSION_BY_CONTENT_TYPE`.** A type without one falls through to the supplied name, which is the hole this module closes; `fileName.test.ts` asserts the map covers the list.
- In `lib/services/fitness-files/`, only the stored name is sanitized. `getFitnessFileType` keeps reading the **raw** name: the 200-byte cap can truncate a long name past its extension, and that function throws when neither the name nor the MIME type identifies a type. Its return is one of four literals and is the only part of a supplied name that reaches a storage path.
- Covered by `lib/services/medias/fileName.test.ts` plus entry-point regression tests in `localFile.test.ts` of both `medias/` and `fitness-files/`, `S3StorageFile.saveFile.test.ts` / `S3StorageFile.presigned.test.ts` in `medias/`, and `S3StorageFile.test.ts` in `fitness-files/`.

#### Stored bytes served from our own origin

- **`GET /api/v1/files/...` never trusts a stored object's content type.** It is unauthenticated and serves from the app origin, whose CSP allows inline script, and an object-storage object's type is whatever its PUT declared. `getServedMediaHeaders` (`lib/services/medias/servedMediaHeaders.ts`) serves only an allow-listed media type inline; anything else (`text/html`, `image/svg+xml`, an empty type) goes out as an `application/octet-stream` attachment. Every response, the removed-media placeholder included, carries `nosniff` and the sandboxed `MEDIA_FILE_CONTENT_SECURITY_POLICY`.
- **That CSP is set in `proxy.ts`, not only in the route.** Next keeps a header the middleware response already carries over the route's own, so the route cannot tighten the app policy by itself; the proxy matches the decoded, slash-collapsed path.
- **The presigned media PUT signs `Content-Type`** (`signableHeaders`), which the presigner otherwise leaves unsigned, and returns it in `headers` so the client sends exactly that value. A PUT that is never completed still leaves its object in the bucket, so verifying the type at completion alone was not enough.
- **The object-storage driver reads and redirects only under `medias/`** (`isObjectStorageMediaKey`, `lib/services/medias/reservedPaths.ts`), checked on both the raw key and its canonical form, so the route is not a proxy for anything else an operator keeps in the bucket.
- **Both drivers stream the object** (`type: 'stream'`) instead of buffering it, so a request cannot pin a whole object in memory.
- Covered by `app/api/v1/files/[...pathname]/route.test.ts`, `test/proxy.test.ts`, `lib/services/medias/reservedPaths.test.ts` (the `medias/` prefix check), `S3StorageFile.presigned.test.ts` (the signed `Content-Type`), and `S3StorageFile.saveFile.test.ts` (the streamed `getFile`) / `localFile.test.ts` in `lib/services/medias/`.

#### What the gallery lookups disclose to third parties

- **Reverse geocoding sends a location to a third party.** `ResolveMediaPlaceJob` sends only the 0.05 degree snapped cell centre (about 5 km, the grid the public `area` precision uses) to Nominatim, never the stored point, and does it for every GPS upload, including those whose precision is `hidden` (so the place can be prefilled for the owner). Public Nominatim (OSMF) is the default; an admin can turn it off under Admin → Network → Place names or point `ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT` at their own. The request carries a `User-Agent` and, when `ACTIVITIES_GALLERY_NOMINATIM_EMAIL` is set, an `email` parameter, as Nominatim's usage policy asks.
- **Species lookups send a subject name to GBIF**, nothing about the photo, its owner or its place. The vision request for suggestions sends the image to the endpoint configured for alt text (`ACTIVITIES_ALT_TEXT_*`), exactly like generated alt text, and the API key is never forwarded to GBIF or Nominatim.
- **`gallery_lookup_cache` is a coarse location trace.** It has no actor column, but each `geocode` key is a 5 km cell, so the table records where the instance's photos were taken. Prune it with `backfillGalleryLookups.ts --prune-cache` and treat it like the other media tables when backing up or exporting.
- **Threatened-species hiding fails closed**, so with lookups off or unreachable the price is that every species photo's place stays hidden from others while `hideThreatenedPlaces` is on. Choosing "unknown means shown" instead would publish the places of the very animals the switch exists to protect, and is not offered.
- Covered by `lib/services/gallery/{publicMediaDetails,galleryProjection,galleryQueries}.test.ts` (the threat-status matrix) and `lib/services/gallery/lookups/*.test.ts`.

#### Video preview frames and automated alt text

- **A video's preview frame comes from ffmpeg's `thumbnail` filter, which picks a representative frame instead of frame 0.** `extractVideoImage` (`lib/services/medias/extractVideoImage.ts`) runs `ffmpeg -threads 2 -max_pixels <8192²> -i <file> -map 0:v:0 -vf <VIDEO_PREVIEW_FILTER> -frames:v 1 -update 1`, where the filter first scales into a 1280px box and then runs `thumbnail=n=50`. Taking the first decodable frame — the previous behaviour — produced a black or blank poster, and that same frame is what the alt-text model was asked to describe. **The scale must stay before `thumbnail`, and the batch small**: `thumbnail` holds its whole batch uncompressed, and at its default 100 frames at input resolution a short 4K clip peaked at ~1.6 GB resident (~245 MB scaled). Uploaded videos are also refused when **any** video stream is above `MAX_VIDEO_DIMENSION` per side by `getAcceptedVideoDimensions` (`lib/services/medias/videoProbe.ts`), the one acceptance rule both drivers and the presigned completion share. Checking only the first stream is not enough: without `-map` ffmpeg's automatic selection decodes the largest or default-disposition track, so a 64x64 first track could vouch for a 12000x12000 second one (measured at 1.37 GB resident for five frames). `extractVideoImage` therefore also pins decoding to `-map 0:v:0`, the stream the probe reports, and passes `-max_pixels` (8192², before `-i` so it configures the input decoders, including the ones ffmpeg's own stream probe opens) so a resolution change after the probed header — a mid-stream H.264 SPS — cannot grow the decoder past the cap either. The upload's `ffprobe` runs before this check and is not pixel-capped: its stream-info pass decodes about a frame per stream (~180 MB resident for an 8000x8000 track), not a 50-frame batch. Two limits are worth knowing rather than assuming: `thumbnail` scores only its first batch (50 frames, so a second or two depending on frame rate), so a longer black or blank opening still yields a blank frame; and `-update 1` is not strictly required for a single image2 output (ffmpeg warns and still writes the file) but is kept to make the single-file intent explicit. Every extraction goes through `extractVideoPreviewFrame` (`lib/services/medias/videoPreview.ts`), which writes a server-named temp copy first; see **Uploaded file names are untrusted input** above for why the name takes nothing from the upload.
- **Automated alt text is best-effort decoration and must never fail an upload.** `generateAltText` (`lib/services/altText/openai.ts`, a thin wrapper over the shared `requestVisionCompletion` that subject suggestions also use, so both obey the same timeout, body cap and `safeRemoteFetch` rules) sends the media bytes as a base64 data URL to the OpenAI-compatible vision chat-completions endpoint configured by `ACTIVITIES_ALT_TEXT_*`. For a video it is handed the preview frame as `image/jpeg`; for an image, its own bytes and MIME type. It only runs when the client supplied no description, and its entire body is wrapped in try/catch so it returns null and logs a warn on any provider or network failure. Callers therefore do not need a `catch` around it — the surrounding try/catch on the sync path (`handleSyncMediaUpload`) exists to guard the buffer read, frame extraction and `updateMedia` write, not the generation itself. Similarly, `generateRouteAltText` describes fitness activity route maps using route-specific prompts without meta-preambles when enabled in the actor's Fitness Settings (`generateRouteDescription`, off by default), returning null on failure so background activity processing and map regeneration are never blocked.
- **Both upload paths call it, and the object-storage presigned path only within its byte cap.** The synchronous handler (`lib/services/medias/handleSyncMediaUpload.ts`) extracts the frame from the uploaded buffer before calling the model, and the presigned handler (`lib/services/medias/S3StorageFile.ts`'s `completePresignedUpload`) does the same after downloading the stored object, bounded by `PRESIGNED_ANALYSIS_MAX_BYTES`. When a preview frame is extracted, `completePresignedUpload` uploads it as a thumbnail and attaches it to the media record. Presigned verification (`markMediaUploadVerified`) has already committed by then, so an extraction or vision failure is logged and the upload still completes. **That leniency covers decoration only, never the type check.** Before the row is marked verified, `completePresignedUpload` streams the object to a server-named temp file (whatever its size, holding none of it in memory) and `probePresignedMedia` (`lib/services/medias/presignedProbe.ts`) confirms the bytes are the declared type — sharp must read an image as that exact format, a video must pass `getAcceptedVideoDimensions`, `audio/mp4` must carry an audio stream. Any failure is a `PresignedUploadValidationError`: the object and row are deleted and the route answers 422. The probed width and height replace the client's declared ones. A storage read failure is NOT a validation failure and leaves both in place for a retry. The prompt instructs the model to describe the scene directly, without meta-preambles such as "This video shows" or "Screenshot of".
- Covered by `lib/services/medias/extractVideoImage.test.ts`, `lib/services/medias/videoPreview.test.ts`, `lib/services/altText/openai.test.ts`, `app/api/v2/media/route.test.ts`, `lib/jobs/processFitnessFileJob.routeMap.test.ts`, `lib/jobs/regenerateFitnessMapsJob.test.ts` and `lib/services/medias/S3StorageFile.{saveFile,completion,analysis}.test.ts`.

#### A federated blurhash is untrusted input

- **A blurhash is the one media field a remote actor supplies directly, and `normalizeBlurhash` (`lib/services/medias/imageAnalysis.ts`) is what decides its stored form.** It returns the string to persist or null, never a boolean, because the check normalises before deciding: the predicate it replaced compared `hash.trim()` while `createNoteJob` stored the untrimmed original, so a whitespace-padded hash on a federated note was approved on the trimmed copy and written in a form `decode` throws on (`length is 29 but it should be 28`). Both halves of the check are load-bearing and neither subsumes the other — `BLURHASH_REGEX` covers the base83 alphabet, which `isBlurhashValid` never looks at, and `isBlurhashValid` covers the structure the regex cannot see, that the length must be `4 + 2 * componentX * componentY` for the size flag in the value's own first character, which is why `'aaaaaa'` is well-formed base83 of a legal length and still throws. `createNoteJob` is the only path that stores a peer-supplied hash; every other writer, `medias.blurhash` included, gets one from `computeBlurhash`, i.e. from `encode`, so it is canonical by construction.

#### A stored media URL is only ours if the host says so

- **Recover a stored media path from a URL with `getMediaPathFromFileUrl` (`lib/services/medias/mediaFileUrl.ts`) — never by checking the `/api/v1/files/` prefix on its own.** That route is this project's own, so **every other activities.next instance serves its attachment URLs under exactly that path**. A path-only check therefore reads a remote instance's URL as one of our storage paths: the lookup misses in storage, and at a caller that treats "not local" as "fetch it over HTTP instead" the download branch is skipped entirely, so the archive or backfill references a file it never obtained. `scripts/backup/actorArchive.ts` (attachment URLs plus the actor's `iconUrl`/`headerImageUrl`) is migrated to this shared, host-aware parser. `scripts/maintenance/backfillMediaBlurhash.ts` hit the same bug independently and fixed it first, in #1559, with its own `getLocalStoragePath` / `isOwnAuthority`. #1569 shared the **traversal half** and #1570 the **host half**, so that copy is gone and both callers reach this one parser. The two matchers were measured rather than assumed to agree, and differed in exactly one way: `isOwnInstanceHost` strips BOTH default ports where the script's copy treated only `:443` as implied, so `https://<our-host>:80/api/v1/files/…` is now accepted — the same hostname either way, and pinned by a test. It is the inverse of `getMediaFileUrl` and lives beside it.
- **The host question is `isOwnInstanceHost` (`lib/utils/host.ts`), not `isHostTrustedByRules`.** It must include `ACTIVITIES_TRUSTED_HOSTS`: a multi-domain instance builds a media URL from the OWNING actor's domain (`getAttachmentMediaMetadata` is handed `currentActor.domain`), which is not necessarily the configured primary host. And it must not be `isHostTrustedByRules` alone — that answers the narrower "may an inbound `X-Forwarded-Host` be believed", for which `normalizeHost` deliberately rejects loopback names, so on a `localhost:3000` development instance it says no to the instance's own host. `isOwnInstanceHost` compares canonical authorities first (covering that case and every exact `host:port` match), then defers to the rules matcher for wildcard entries.
- **A recovered path that walks upwards, that is absolute, or that carries a NUL byte is refused too (`isTraversingStoragePath`) — and the check has to run AFTER decoding.** `new URL()` resolves dot segments, and decodes the dots themselves to find them, but only where the separators are literal slashes: `https://<our-host>/api/v1/files/..%2f..%2fsecrets/env` therefore reaches the decoder still spelled `..%2f` and comes back as `../../secrets/env`. The host-relative branch parses no URL at all, so there a plain `/api/v1/files/../../secrets/env` is never normalised either. **This was a live vulnerability, not a theoretical one:** `POST /api/v1/accounts/profile` takes `iconUrl`/`headerImageUrl` as bare `z.string()` and stores them verbatim, so any signed-in local user could point their own avatar at such a URL and have `copyProfileImage` ship an arbitrary file off the operator's machine inside their own account export. Only a segment that RESOLVES to `..` is refused, so `ab/..cd.webp` stays an ordinary stored file name. **Windows is covered deliberately** — the archive and maintenance scripts run wherever the operator runs them — so `\` is a separator, `C:` is absolute, and a segment of bare dots and spaces carrying two or more dots is refused, because Windows normalises trailing dots away and Node's own `path.win32` does not model that. Refusing the whole shape is deliberately wider than the exact spellings Win32 collapses; nothing this instance stores is named out of dots, so over-refusing costs nothing and does not depend on getting the platform's rules exactly right. That is TRAVERSAL coverage, not a claim that every Win32 quirk is handled — a reserved device name like `CON` still resolves to a device, as it already does for `LocalFileStorage.getFile`. The rule is single-sourced and shared with the blurhash backfill; do not fork it. The check reads the DECODED path, so the one shape that escapes it is a path whose escapes cannot be decoded at all — `decodeURIComponent` throws on the first bad escape anywhere in its input, so `..%2f..%2fetc%2fpasswd%zz` comes back still-encoded and reads as one segment. That is inert only because no consumer decodes again (`path.join` and an S3 key both treat `%2f` literally); a consumer that does decode needs its own check.
- **`copyProfileImage` resolves and confirms containment for itself as well**, through the shared `resolveStorageFilePath` (`lib/services/medias/storagePath.ts`), rather than trusting the parser — the same reason `createMediaTempFilePath` asserts its own result is still under `tmpdir()`. It is the step that turns a stored path into a file read off the operator's machine, and its signature says nothing about where that path came from. Resolving rather than joining is what lets an absolute path be seen as outside instead of silently reinterpreted; `LocalFileStorage.getFile` already makes the identical check against its storage root, while `S3FileStorage.getFile` only refuses a key outside the `medias/` prefix (`isObjectStorageMediaKey`) — inside it, an S3 key that traverses is merely inert, not refused, and with a CDN `hostname` configured it is string-concatenated into a redirect URL — which is why the decision belongs in the parser rather than being left to "the driver will reject it".
- **A wildcard `ACTIVITIES_TRUSTED_HOSTS` entry must never be compared as a literal authority, and the check belongs AFTER parsing.** `new URL()` accepts `*` in a host, so `isOwnInstanceHost`'s exact-authority pass matched a URL whose authority was spelled exactly `*.cdn.example` and handed back its path as one of our own — the same hole `backfillMediaBlurhash.ts`'s `isOwnAuthority` documents closing in #1559, reintroduced by #1560. **Both passes need their own guard, for different reasons.** The exact pass reads RAW rules, so it skips any rule containing `*`. The rules pass normalises first, and `normalizeHost` recognised the documented `*.example.com` form only on the RAW value — missing it behind a scheme, and recognising it nowhere else — so `*example.com` (a plausible typo of it), `cdn.*` and `foo.*.example.com` all survived as LITERAL hostnames carrying a `*`, which `hostMatchesRule` compared literally; `new URL()` percent-decodes `%2a` in an authority, so a caller could spell one exactly and be believed. `normalizeHost` now refuses any parsed hostname still containing `*`, and reads the `*.` marker off the AUTHORITY so a scheme-prefixed rule still expands. It is dropped **silently by `normalizeHost` itself** — `normalizeHostRules` flat-maps the null away, and it is a per-request path behind a cache, so it is the wrong place to log from; `buildTrustedOrigins` is the one consumer that warns.
- **A misplaced wildcard has to be refused at every consumer, because each interprets it differently**, and **each must read the PARSED hostname — the parser is what MAKES the `*`** (it percent-decodes the authority, applies IDNA mapping and strips tab/CR/LF, so `%2aexample.com`, `user@%2aevil.com` and a fullwidth `＊example.com` all arrive already spelled with one). Three consumers apply it: `normalizeHost` (`lib/utils/host.ts`), `buildTrustedOrigins` (`lib/services/auth/trustedOrigins.ts`) and `toHostname` (`lib/services/auth/servedDomains.ts`). There were four until #1570 deleted `isOwnAuthority` from `scripts/maintenance/backfillMediaBlurhash.ts` — that sweep now asks `isOwnInstanceHost`, so it inherits both of that function's guards instead of carrying its own. `buildTrustedOrigins` matters most: better-auth routes any pattern containing `*` through `wildcardMatch`, so `*example.com` GLOBBED `evilexample.com`, gating both the Origin check on state-changing auth requests and `callbackURL`/`redirectTo` — an open redirect carrying auth callbacks. It must also **require a web scheme**, because it checks `hostname` but pushes `origin`, and `blob:` derives its origin from the inner URL in its PATH while reporting an empty host — the one scheme where the two disagree. **`getAllowedOrigins` in `app/api/v1/fitness/apple-maps-token/route.ts` is a fifth consumer that does NOT filter**, minting the MapKit JWT's `origin` claim straight from `host` + `trustedHosts`; whether Apple treats `*` as a glob there is unverified, so filtering could equally close a hole or break a multi-domain deployment. Establish that before sweeping it. `getCanonicalAuthority` is exported for a different question entirely: it is the shape `getMediaFileUrl` consumes, so the backfill's fallback authority is normalised the way the comparison normalises one, instead of by a fourth copy of the same regex chain. Not `getConfiguredHost`, which falls back to the RAW value whenever `normalizeHost` refuses it — every loopback and every malformed one — and must never decide trust.
- **A profile image URL a client submits is validated on write with `parseProfileImageUrl` (`lib/services/accounts/profileImageUrl.ts`), which accepts ONLY a URL SHAPED like one this instance serves its own media from — our own host, under `/api/v1/files/`, no traversal.** It checks the host and path, not the `medias` table: a well-formed URL naming a file that was never uploaded still validates, which is fine, because what this closes is the URL pointing somewhere we do not control. `POST /api/v1/accounts/profile` took `iconUrl` and `headerImageUrl` as bare `z.string()`s and spread them into `updateActor`, so any signed-in local user could point their own avatar at an arbitrary host — which then became a tracking pixel for every viewer of their profile, and, for the actor's icon, was republished as `icon.url` to every instance that fetches the actor. **`z.url()` is NOT this check and does not stand in for it**: in Zod 4 it accepts `javascript:`, `data:` and `file:` URLs, so shape validation alone leaves exactly the schemes worth refusing. **The protocol allowlist needs a test case that ALSO passes the host and path checks** — `ftp://<our-host>/api/v1/files/abc.jpg` — because every scheme case that fails those anyway leaves the allowlist unpinned: delete it and they all still pass, which a mutation sweep caught. `new URL` gives `ftp:`/`ws:` a real authority where `javascript:`/`data:` have none, so one of those carrying our own host and a media-shaped path sails through `getMediaPathFromFileUrl` unopposed. The allowlist must run BEFORE the host check for the same reason `getProductUrlHostname` needs one — `new URL` parses an authority for non-special schemes too, so `javascript://<our-host>/%0aalert(1)` presents a perfectly good hostname. A host-relative `/api/v1/files/...` is refused as well, even though `getMediaPathFromFileUrl` resolves one: the value is federated as `icon.url`, where a relative reference names the READER's origin. `POST /api/v1/accounts/image` (the account avatar) shares the one helper. The rule is **input-time only** — a remote actor's `iconUrl` is written from its actor document by `getPersistableProfile` and is legitimately remote, so there is no render-time host gate and existing rows are not re-validated.
- **An empty submitted value CLEARS the image, and the settings field is read-only for that reason.** `ImageUploadField` submits both fields on every save, so an empty one has to mean something; `updateActor` already reads `null` as an explicit clear. Its text box is `readOnly` because the only values the routes accept are the ones its own upload button produces — a typeable box invited a remote URL the server now refuses — so clearing moved to an explicit Remove button. Do not reintroduce the `placeholder` prop suggesting `https://example.com/avatar.jpg`.
- **A submitted value that MATCHES the one already stored is "no change" and is not re-validated, and that is load-bearing.** `/settings` is a SINGLE form around name, summary, both images and the privacy switch, and `ImageUploadField` seeds its hidden input from the stored URL and resubmits it untouched. Without the `currentValue` argument to `parseProfileImageUrl`, an actor carrying a URL stored before this rule existed — which the field's old `https://example.com/avatar.jpg` placeholder actively invited — would 422 the WHOLE form while editing only their display name, losing that edit to a bare `apiErrorResponse` JSON body (no `Location`, so a native form post renders it in place of the page) and with no way to save anything on `/settings` again until they worked out that the image had to be removed first. It gives nothing away: a NEW value still has to pass and clearing still works, so a stale value stays removable rather than sticky. **An EXACT echo is decided first, then an empty submission, then a trimmed match** — three branches because a legacy value that is nothing but whitespace makes all three collide — nothing on the read path trims, so a legacy value can carry copy-paste whitespace, and one that is nothing BUT whitespace is truthy while trimming to `''`, which collides with the empty submission Remove sends. A field the user never touched echoes the stored value BYTE FOR BYTE while Remove submits `''` exactly, so comparing raw first keeps an untouched save from writing `null` over that row; testing the empty submission next keeps the trimmed match from swallowing Remove and leaving the one control that can clear such a row a silent no-op, since the field is read-only and nothing else writes it. The three tests are ordered, not interchangeable: a legacy stored value can be nothing but whitespace — truthy, yet trimming to the same `''` an empty submission does — so each of the three guards a case the other two collide on. They live in `classifySubmission`, which answers `unchanged`/`clear`/`candidate` and carries that reasoning; do not collapse or reorder them. `POST /api/v1/accounts/image` must then SKIP its write on "no change" — `updateAccountImage` always writes, so `iconUrl.value ?? null` would clear the image the form was resubmitting unchanged.
- **`ImageUploadField`'s Remove button hands focus to Upload, and its read-only field names the `dark:` variant explicitly.** Remove is rendered only while a value is set, so activating it unmounts the button that was just pressed — and a focused element removed from the document drops focus to `<body>`, sending the next Tab back to the top of the page (WCAG 2.4.3). This is the same mechanism **Post media layout** documents for the media strip's arrows, but their fix (keep boundary controls mounted with guarded `aria-disabled` and hand focus to the opposite arrow) does NOT transfer: Remove is the only way to clear the image. React batches the state update, so the call would work after it too; it sits first so the handoff does not depend on that. Separately, the field's muted surface must be spelled `bg-muted dark:bg-muted` — `Input`'s own base carries `dark:bg-input/30`, and this project compiles the dark variant as `&:is(.dark *)`, where `:is()` takes its most specific argument's specificity, so a bare `bg-muted` LOSES the cascade and the field stays indistinguishable from an editable one in dark mode. Naming the same variant lets `twMerge` drop the base instead. Nothing catches this automatically: a jsdom `toHaveClass('bg-muted')` passes against the broken form, which is why the test asserts `dark:bg-input` is ABSENT from the rendered class list. The field stays `readOnly` rather than `disabled` because the preview beside it is a background-image `div` assistive tech cannot see, making this field the only announced representation of which image is set.
- **The settings endpoint owns the settings form's fields and nothing else.** `ProfileRequest` also declared `publicKey`, `followersUrl`, `inboxUrl` and `sharedInboxUrl` as free strings that `updateActor` persists, letting any signed-in user rewrite the public key and inbox endpoints their own actor publishes. No form ever sent them. Zod strips unknown keys, so they are simply absent from the schema now; don't add a field back without a form that sends it.
- **`getAttachmentMediaPath` (`lib/utils/getAttachmentMediaPath.ts`) is a different question and not a substitute.** It always returns a string and matches on `indexOf`, because its callers hold a URL this instance just wrote to its own storage. Use it only there — and **never where the recovered path reaches a DESTRUCTIVE storage call**, which is the case that looks like a fit and is not. `deleteSavedMedia` in `app/api/v1/admin/custom_emojis/route.ts` was the last hand-rolled copy of the parse, and its `saved.url` genuinely is a URL this instance minted a few statements earlier, so the host check there is REDUNDANT — but the path it recovers is handed to `deleteMediaFile`, and never returning null means a URL that is not a media URL falls back to the whole pathname and gets deleted anyway. Redundant is not the same as harmful: it uses `getMediaPathFromFileUrl`, whose null refuses what it cannot prove, for one `getConfig()`. That choice is also what gives the delete `isTraversingStoragePath` for free — the guard lives in the parser precisely so every caller inherits it, and `getAttachmentMediaPath` has none.
- **#1569's traversal fix moves URLs INTO this guard's branch, which is why the ordering was safe.** `getMediaPathFromFileUrl` now returns null for an own-host URL whose decoded path traverses, and that movement is strictly one-directional — it only ever adds null returns — so such a URL stops taking the local-storage branch and starts taking the remote-fetch branch. Had #1569 landed against an unguarded `registerAttachmentUrl`, it would have WIDENED the plain-`fetch` surface by exactly that set. With the guard in place both landings are safe: an own-host traversing URL becomes an ordinary unauthenticated HTTPS request to our own public file route (which any anonymous user can already issue, and `LocalFileStorage.getFile` contains), and a host-relative one throws in `new URL()` and is refused.
- **Once the host check says a URL is NOT ours, fetching it is an SSRF question — use `safeImageFetch` (`@/lib/utils/safeImageDownload`) plus a byte cap, never a plain `fetch`.** `attachment.url` is attacker-controlled by the account owner: `POST /api/v1/accounts/outbox` takes `PostBoxAttachment.url` as a bare `z.string()` (`lib/types/domain/attachment.ts`) and `createAttachment` writes it verbatim from `lib/actions/createNote.ts`. So `registerAttachmentUrl` in `scripts/backup/actorArchive.ts`, whose `--fetch-remote-attachments` branch is reached exactly when `getMediaPathFromFileUrl` says the URL is not ours, was making the exporting machine issue an owner-chosen request and writing the response body into `media_attachments/remote/<sha>.<ext>` of the tarball the owner receives — link-local `169.254.169.254` included. The guard pairs `safeImageFetch` (which refuses non-HTTPS, embedded credentials, and any hostname resolving to a restricted address, re-checking **every** redirect hop) with `readResponseArrayBufferWithLimit`. No content-type check, unlike `downloadRemoteImage`: an archived attachment can legitimately be video or audio. The residual DNS-rebinding window `safeImageDownload.ts` documents applies here too — but the guard forces `https:`, so a flipped record yields a TLS handshake carrying the attacker's SNI against an internal IP, which a plain internal HTTP service cannot complete; the realistic yield is a timing oracle, not body exfiltration, which is why this does not justify a binary-mode `createSafeRemoteFetch`.
- **The guard belongs on the untrusted input, not on the shared fetch helper.** `fetchPublicStorageResponse` (`scripts/backup/productionArchive.ts`) keeps its plain `fetch`, because its other caller `downloadPublicStorageFile` builds URLs from `getStorageEndpoint(hostname)` — the **operator's own** configured storage endpoint, which may legitimately be a private-network MinIO or a plain-http loopback in dev, both of which `safeImageFetch` refuses by design. Pushing the guard down into the helper would have broken the trusted caller while fixing the untrusted one.
- **A timeout that bounds a body read is also a throughput floor, so it cannot be inherited from a header-only one.** `fetchPublicStorageResponse` cleared its 60s timer in a `finally` that ran the moment headers arrived, leaving the body read untimed; `safeImageFetch` keeps its `AbortSignal.timeout` live for the whole read. Passing the old 60s through would therefore have required a sustained 3.5 MB/s to reach even the default 200 MiB cap — silently dropping large federated video from archives that used to contain it, which in a _backup_ is the worst place for silent data loss. Hence `REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS` (10 minutes). It is passed to `safeImageFetch` **twice** — as the per-hop `timeoutMs` and as an overall `signal` deadline — because `timeoutMs` alone restarts on every hop, and the loop runs `hop <= MAX_SAFE_IMAGE_REDIRECTS`, i.e. **four** fetches, not three. Per-hop only, a host stalling just under the limit at each hop costs 40 minutes for ONE attachment, and while a single status is capped at `MAX_STORED_MEDIA_ATTACHMENTS`, an actor's whole history is not — the export walks every one of them sequentially, so an account facing a ban or a legal request, exactly when `--fetch-remote-attachments` gets used, could stall the export for days. The deadline is what bounds an attachment rather than a request. Note it bounds the FETCHES only: `getSafeImageDownloadUrl`'s DNS lookup runs before the signal is attached, so the true ceiling is the deadline plus resolution time at each hop.
- **The per-attachment deadline bounds one attachment; `--remote-fetch-budget` bounds their sum, and it may only decline to START work.** Ten minutes times an actor's whole history was still days. The argument that blocked an aggregate bound for a round — that any such bound would abort a legitimate large download and so trade a stall for silent data loss, which is worse in a backup — was a false dichotomy: a budget that stops STARTING new downloads once exhausted, never aborting one in flight, degrades through the warn-and-keep-the-absolute-URL path `registerAttachmentUrl` already takes for every refused, over-size or failed attachment, which is exactly the behaviour of omitting `--fetch-remote-attachments`, applied to the tail. That loses nothing, so it is now built (default 3600s). **Four details are load-bearing.** The gate sits BELOW the local-storage branch, because a path this instance already holds costs no network and an exhausted budget must not start dropping the actor's own media. The deadline is stamped ONCE where `remoteFetch` is built, not per attachment — recomputed per attachment it is no bound at all, since every attachment then finds a full budget ahead of it. **That one is proved by running a whole export** (`scripts/backup/actorArchiveExport.test.ts`, which charges the mocked clock per download so the budget demonstrably runs out partway), and the history is why: three source-text spellings of the guard were tried first and review defeated each with a different rewrite of the same bug — the last a helper defined above the loop and CALLED inside it, textually indistinguishable from the correct code. A regex can say where an expression is written, never how often it is evaluated; don't put that guard back. The sibling property — `remoteFetch.deadline` is read exactly once, by the gate, because wiring it into `safeImageFetch` as a signal is the abort-in-flight mistake — stays a source assertion in `actorArchive.attachments.test.ts`, and legitimately: it only misbehaves once real time elapses, so catching it behaviourally would mean racing the machine the test runs on. It is wall-clock rather than a meter of time spent inside fetches, because metering the fetches leaves the run unbounded the moment the slowness comes from anywhere else. And the skipped count is reported as its OWN `manifest.json` line (`buildRemoteFetchBudgetWarning`), because "this run ran out of time" is answered by re-running with a larger budget and "these downloads failed" is not. Because nothing is aborted, the true ceiling is the budget plus one `REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS`.
- **The cap is the RESOLVED `media.maxFileSize`, threaded in as a parameter — never the `MAX_FILE_SIZE` constant.** That constant is only the default; an admin may raise the setting to `MAX_CONFIGURABLE_FILE_SIZE` (1 GiB), and `getMaxMediaUploadSize(database)` resolves env -> database -> default. Reading the constant refused a remote attachment this instance's own upload path would accept, and the media upload paths resolve the setting for exactly this reason. `exportActorArchive` resolves it once before the status loop (it is a database read behind a 15s cache, and the cap must not shift mid-run). Being a parameter is also what makes the byte cap testable: at a realistic 200 MiB the streaming accumulator is unreachable from a test, so a cap test pinned to the constant proves only the `content-length` short-circuit.
- **A refusal from `safeImageFetch` has three causes, the warning must not name only one, and that wording is a SECURITY property rather than operator ergonomics.** It answers `null` for an unsafe URL, for a redirect with no usable `Location`, and for exhausting `MAX_SAFE_IMAGE_REDIRECTS` — so naming only "unsafe address" sends an operator whose CDN merely chains four redirects hunting a DNS problem that does not exist. The deeper reason to keep one string for all three: `getSafeImageDownloadUrl` resolves through `lookup(...).catch(() => [])`, so a hostname that does not exist and one that resolves to a private address produce the SAME refusal. Splitting the message per cause would hand the account owner — who chose the URL — an oracle for internal DNS, telling them which names exist inside the network. Do not "improve" it into distinct messages.
- **The SPACE half of the residual is still open: the time half is now bounded across the export, the bytes are not.** `readResponseArrayBufferWithLimit` buffers, and `Buffer.concat` briefly holds both copies, so one attachment peaks near twice the resolved cap — up to ~2 GiB where an admin has raised `media.maxFileSize` to `MAX_CONFIGURABLE_FILE_SIZE` — while nothing bounds the total written into `os.tmpdir()` across an actor's whole history. `--remote-fetch-budget` bounds it only incidentally, by ending the phase that writes. The fix is the same shape as the time budget and degrades the same non-destructive way — decline to START a download once a byte budget is spent, never abandon one — and it is unbuilt, not rejected. Still strictly better than the unbounded read this replaced.
- **The archived file's extension comes from the attacker's URL and is unrelated to its bytes.** There is deliberately no content-type check (an archived attachment may be video or audio), so `extname` on the URL path is all there is. `path.extname` reads the basename, so it can never contain a separator and cannot traverse — proved against percent-encoded slashes, backslashes and `%00` — and the bytes are inert inside a tarball. It matters only if an operator ever serves an extracted archive over HTTP, which is the same shape as the `text/html`-from-`extname` bug the local media driver had.
- **The refusal tests run the REAL guard, not a mock.** Mocking `safeImageFetch` itself proves only the wiring, and a revert to a plain `fetch` would still pass. What makes the real guard usable in a test is that `test/setup/vitest.setup.ts` mocks `node:dns/promises` to resolve every hostname to the public `93.184.216.34`, so the hostname-based happy-path tests still reach the mocked network. Note the refusal rows themselves never reach DNS: IP literals take the `isIP` branch, `localhost` is caught by the hostname-name check before the lookup, and a `http://` URL is refused on protocol before the hostname is parsed.

#### A stored path is confined to the storage root

- **Every filesystem path a local STORAGE DRIVER builds runs through `resolveStorageFilePath` / `assertStorageFilePath` (`lib/services/medias/storagePath.ts`) — never a bare `path.resolve(root, filePath)`.** A stored path is data: it reaches a driver from a `medias` / `fitness_files` row, from a URL path segment, or from an archive entry, and `path.resolve` walks straight out of the root given `../` or an absolute path. The escape is silent, because the read or the unlink simply lands somewhere else on disk. `resolveStorageFilePath` answers null, for a read or delete that has somewhere to return it, and logs the refusal — the only signal an operator gets from a branch that should never fire; `assertStorageFilePath` throws, for a write whose only alternative is creating a file the driver does not own. A caller that wants its own context in the error takes `resolveStorageFilePath` and throws its own, as `scripts/maintenance/cleanupMediaStorage.ts` does.
- **The rule covers delete and write, not just read.** `LocalFileStorage.getFile` carried the check inline while `deleteFile` beside it resolved and `unlink`ed with none at all. Nearly every caller **reads** a server-generated path from a row, so it was latent rather than live — but two do not, and `GET /api/v1/files/[...pathname]` is the one that matters: it hands the CLIENT's own URL segments to `getMedia` and so to the driver. Keep its own `path.isAbsolute(normalizedPath) || /^[a-zA-Z]:/` refusal: it is what makes that a 404 at the edge. Behind it, per the bullet above, `resolveStorageFilePath` answers null on an out-of-root path and `LocalFileStorage.getFile` returns that null unchanged, leaving the ROUTE to turn it into the served placeholder. The other **derives** rather than reads: `deleteSavedMedia` (`app/api/v1/admin/custom_emojis/route.ts`) slices the tail off a `/api/v1/files/` URL and `decodeURIComponent`s it, which would turn `%2e%2e%2f` into traversal the moment its input stopped being `saveMedia`'s own output. The asymmetry is the problem: containment was an invariant of the callers, not of the driver, so it held only until someone added a caller, and it made "the storage drivers refuse such a path" false as a claim about the pair (a review of PR #1570 had to narrow a comment in `mediaFileUrl.ts` for exactly that reason). An unlink is the more damaging half. The write paths generate their own names today, so the assert there is the belt rather than the braces, and is applied anyway so confinement is a property of the driver.
- **The module lives under `medias/` and is shared, the same way `medias/fileName` and `medias/quota` already are.** `lib/services/fitness-files/localFile.ts`, `lib/jobs/importStravaArchiveJob.ts`, `scripts/maintenance/cleanupMediaStorage.ts` and `scripts/backup/actorArchive.ts`'s `copyProfileImage` import it too — it replaced the near-identical `fitness-files/path.ts` **and** the cleanup script's own hand-rolled check, which compared against a bare `path.resolve(basePath)` and so accepted a sibling directory the root's name prefixes (`/srv/uploads` accepted `../uploads-backup/x`, and then `unlink`ed it). That is why the helper appends `path.sep` to the root. Note the root itself resolves to itself; only a path that leaves the root is refused. **`copyProfileImage` is the one migration that fixed nothing**, and it is worth knowing which kind a call site is: it asked the same question with `path.relative` — `'..'`, a `..` + separator prefix, or an absolute answer — which carries the separator boundary for free and so never had the cleanup script's bug. It moved because a fourth spelling of one question is a fourth place to forget, not because it was wrong; its test pins the shared helper's log for exactly that reason, since on every input that can reach it the two forms return the same value and push the same warning, leaving the log as the only observable difference.
- **The check is CASE-SENSITIVE, and `cleanupMediaStorage.ts` inverts that — do not reconcile the two.** Its `getContainedRelativePath` resolves symlinks and, where `process.platform` says the filesystem folds case, compares segments case-insensitively, because for a tool that DELETES files, concluding "unrelated" is the expensive direction to be wrong in; here the trade is inverted and over-refusing costs nothing. No live caller reaches the difference — but resist writing down WHY as a closed list, and resist saying which platform takes which branch. Both are claims about a moving set: state the rule, not the inventory. It is the one input where the `path.relative` spelling `copyProfileImage` used disagreed, and `storagePath.test.ts` now pins the refusal as a **characterization** test — it records that the direction is deliberate, so loosening it means re-arguing the trade rather than deleting an unexplained line.
- **The check is LEXICAL, so a symlink under a storage root defeats it.** It never calls `fs.realpath`, so a link inside the root pointing outside resolves to a path that passes — a read would follow it, though an unlink would only remove the link. Both predecessors were lexical too, and nothing creates symlinks in either root (the Strava archive reader decompresses entries into memory, not onto disk, so there is no zip-slip route to plant one), which is why this stays a documented residual rather than a `realpath` call. Anything that gains the ability to create a link under a storage root changes that.
- **The call-site rule is LINT-ENFORCED, by two AST rules in `lint/agentsRules.mjs`.** `agents/no-storage-path-builder` bans `path.resolve`/`path.join` in the two local drivers, which `.oxlintrc.json` names exactly; `agents/no-resolved-path-prefix-check` bans `startsWith` against a resolved path everywhere. Both resolve names through scope, so a renamed import, a destructured `const { resolve } = path`, `path['resolve']`, `path?.resolve`, `path.posix.join` and a `require('path')` alias are all the same node — and so is a call `prettier --write` wrapped across lines, since the rule never sees text. `extname`/`dirname`/`relative` READ a path rather than build one and are untouched, as are `Array#join` and `Promise.resolve`.
- **The extracted-variable spelling is the residual these rules exist to close.** `const root = path.resolve(base); … full.startsWith(root)` carries the identical missing-separator bug as the inline form, and telling it apart from a name that merely reads like a resolved path needs the declaration — an earlier text heuristic reported an unrelated `const resolvedArchivePath = 'database.'` in `scripts/backup/productionArchive.ts` for exactly that reason. The rule follows the binding, so the string-initialised one stays quiet, and so does the correct idiom, whose prefix is built by a conditional that appends `path.sep`.
- **`scripts/**` is in `.oxlintrc.json`'s `ignorePatterns`, and dropping it from this rule would narrow coverage** — `scripts/maintenance/cleanupMediaStorage.ts` is where the one real instance of the bug was found. Un-ignoring the tree wholesale would put ~50 rules onto files that have never satisfied them (15 errors today), so `yarn lint` instead runs oxlint a **second time**, `oxlint -c lint/oxlintrc.scripts.json scripts`, with that one rule and nothing else enabled. Keep that config minimal: anything added to it starts linting the whole scripts tree.
- **What the rules still do NOT catch, and a reviewer is the enforcement for:** a helper module that resolves on a driver's behalf, a path built by string concatenation or `path.normalize`, a binding imported from another module, a nested destructure (`const { posix: { resolve } } = path`), and an alias chain longer than `MAX_ALIAS_DEPTH` hops.
- **Every predicate strips `TRANSPARENT_WRAPPERS` first — the node types that wrap an expression without changing the value it evaluates to.** An optional chain, TypeScript's `as` / `satisfies` / `<T>` / `!` assertions, and a bare generic instantiation (`foo<T>`), all erased at runtime. A type switch stops at any of them, they NEST, and they arrive in different POSITIONS — which is why it is a loop over a set and not a check at one site: `path?.resolve` is a `ChainExpression` AROUND the member, `path!.resolve` is a plain member whose OBJECT is the wrapper, and `path.resolve(base) as string` wraps the CALL. An inline `path?.resolve(x)` is caught with no unwrapping at all, because there the chain wraps the call and the rule reads its callee — which is exactly what hid the class. Three review rounds each found one member of it before the set banned the category instead of the spellings that turned up.
- **`MAX_ALIAS_DEPTH` counts one unit per hop.** A helper delegating within the same hop passes `depth` through rather than adding to it. Charging twice made a three-step rename fall off a budget of five — one step past the rule's own worked example — while the sibling predicate, which recurses into itself, reached four.
- **Every `TRANSPARENT_WRAPPERS` entry is pinned by a fixture that fails when it is removed; nothing goes in unpinned.** An unpinned entry is a claim the suite does not check, which is how `TSTypeAssertion` sat there proving nothing while this section promised it. `TSInstantiationExpression` was removed once as unreachable and had to be put back: `(path.resolve as unknown as GenericResolver)<string>` compiles clean under `yarn typecheck`, and with the entry gone both rules reported nothing for the call. **Mind which expression a diagnostic code describes** — bare, `path.resolve<string>` is a TS2635; add the call parens and `path.resolve<string>(a, b)` is TS2558, same file and same tsconfig, because it is a different node. Two review rounds asked for the code to be "corrected" after testing the call form.
- **These rules replaced a raw-text scan, `storagePathCallSites.test.ts`, and caught strictly more. Do not reintroduce one for this.** Five review rounds each broke a cleverer version of that file, in both directions — alias tracking fell to a destructured rename, to a nested call, and to `prettier --write` wrapping a call across lines; a substring ban fell to `path['resolve']`; an extracted-variable heuristic reported an unrelated `const resolvedArchivePath = 'database.'`; an import regex matched nothing on a wrapped import and passed VACUOUSLY; and a comment-stripping pass read the `/*` inside the MIME string `'*/*'` as a comment opener and silently blanked two thousand characters of another module. Every one of these shapes needs to know what a NAME refers to, which is scope resolution. A text scan is still right for a LITERAL token rule — that is what the other grep-style guards in this repo do — but not for a call-site invariant.
- **One property did NOT survive the move, and it is the one the old test was best at: a lint rule can be silenced with a comment.** `// oxlint-disable-next-line agents/no-storage-path-builder`, or a file-level `/* oxlint-disable */`, turns either rule off with no diagnostic and nothing reporting the suppression — where the raw-text scan could not be quietly disabled at all, since a comment naming a banned pattern FAILED it. That escape hatch is the repo-wide convention for every `agents/*` rule and is not worth revoking for these two, but it means a disable comment on one of them is a **review** event: it is the one edit that turns the guard off, and it looks like housekeeping. The driver-level traversal tests in `localFile.test.ts` still cover the existing call sites behaviourally; a NEW call site added with a suppression comment and no test is what nothing catches.
- **`lint/agentsRules.test.ts` guards both rules, and guards their WIRING separately.** Fixture-config tests prove what each rule decides, including that it stays quiet on `path.extname`, on the name-reuse shape and on the separator-boundary idiom. A second group runs the repo's OWN `.oxlintrc.json` and `lint/oxlintrc.scripts.json` — relocated over a fixture tree, with only the plugin path rewritten — because a rule cannot prove it is pointed at anything: an override naming a driver that has since moved reports nothing, silently. That group also asserts both driver paths exist and that `yarn lint` still runs the scripts pass.
- **The object-storage drivers are a different question.** An S3 key has no filesystem root to escape, so `medias/S3StorageFile.ts` and `fitness-files/S3StorageFile.ts` are deliberately not covered by this.
- Covered by `lib/services/medias/storagePath.test.ts` and `lint/agentsRules.test.ts`, plus driver-level regression tests in `lib/services/medias/localFile.test.ts`, `lib/services/fitness-files/localFile.test.ts` and `scripts/backup/actorArchive.test.ts` — including a storage root configured **relatively**, which is what `ACTIVITIES_MEDIA_STORAGE_PATH`'s `./uploads` default ships.
- **"Is this string shaped like traversal?" is a DIFFERENT question from "does this resolve inside THIS root?" — do not fold one into the other.** A shape check takes no root, has to run after decoding, and is where over-refusing `\` and NUL for Windows operators belongs — that is `isTraversingStoragePath` (`lib/services/medias/mediaFileUrl.ts`, from #1569), which is what a path recovered from a URL needs. `resolveStorageFilePath` takes exactly one root, is meaningless without it, and is what a path handed to a storage driver needs. Neither subsumes the other — `scripts/backup/actorArchive.ts`'s `copyProfileImage` is the clearest illustration, because it is behind both: the shape check refuses the traversal at URL recovery, and the root check refuses it again at the copy, where the root is finally known.
- **`productionArchive.ts` keeps its OWN containment check, and that is not drift.** `scripts/backup/productionArchive.ts` builds paths under the same storage roots through `assertRelativeFilePath` / `normalizeStoragePath`, which reject any `..` outright — stricter than this module, and applied to an archive entry's name rather than to a root-relative stored path. They answer a different question on different input; what this module owns is the drivers.

#### The archive manifest withholds where storage lives

- **`manifest.json`'s `storage[].failedFiles[].error` never carries a storage-driver message.** `redactStorageSource` (`scripts/backup/productionArchive.ts`) keeps only `kind` and `prefix`, dropping the bucket, region, endpoint, CDN hostname and local root — and that field sits in the same manifest, so it used to put all of that straight back. An export run with `--allow-missing-storage` against a private-network MinIO shipped `getaddrinfo ENOTFOUND minio.internal` inside the tarball; the local driver shipped `ENOENT: … copyfile '/srv/uploads/…'`. **This binds the actor archive too** — `scripts/backup/actorArchive.ts` imports the same `archiveStorage`, and that manifest is handed to the user whose data it is, not to the operator.
- **The claim is about that one field, not the whole manifest.** `actorArchive.ts`'s own `warnings` array, serialized into the same `manifest.json`, still interpolates a raw `error.message` for a failed **remote** attachment fetch. That is deliberate and is not the same disclosure: the fetch is to a third-party host whose URL the warning already names on purpose, and the messages that describe the fetch are `fetch failed`, `HTTP <status>` and `This operation was aborted`, none of which names this instance's own storage. That `try` also spans `new URL` and the staging-directory write, so a local `EACCES`/`ENOSPC` can land there naming the STAGING path — still not the storage root, and still not what `redactStorageSource` withholds, but do not read the list as exhaustive. Do not read the bullet above as covering it, and do not "fix" it by pointing `redactStorageError` at a remote URL it has no source to redact against.
- **`redactStorageError` is an ALLOWLIST, not a scrubber, and that is the point.** It reports the syscall, code, name and HTTP status — `getaddrinfo ENOTFOUND`, `copyfile ENOENT`, `NoSuchKey HTTP 404`, `HTTP 503` — and never the message. A message is free text a driver interpolates whatever it likes into, so a denylist over one is a guess about the forms someone thought of; an allowlist is a guarantee. Two filters back it: a **shape** check (`/^[A-Za-z][A-Za-z0-9_]{0,63}$/`) refuses anything carrying a dot, dash, colon, slash or space, which is what keeps `minio.internal`, `10.4.2.11` and `activitynext-prod-media` out without naming them; on the S3 path **all three of `code`, `name` and `syscall` are whatever the storage server sent** — none is a libuv constant, so never relax the shape check for `code` or `syscall` on the belief that it is one (the mechanism is recorded at the filter) — and a **value** check refuses any token equal to something `redactStorageSource` dropped, for the single-label case the shape check cannot see (a Docker-network `hostname: 'minio'`). Both derive from one definition of "sensitive about a storage source", so a **string** field added to `StorageSource` later is withheld from both halves for free. A non-string one is not, and has to be taught to the value set by hand — the filter records why.
- **It withholds the LOCATION, not every trace of the backend.** A vendor code such as `XMinioStorageFull` still names the storage software. That fingerprint is the price of a code an operator can act on and is worth paying — so state the trade rather than writing that the output says nothing about storage.
- `unknown` is the honest answer for a failure that classifies itself only in its message, and the loss is bounded: **the export console still prints the driver's message in full**, on the operator's own machine, as each file fails. That is why the console line is deliberately NOT redacted — it never enters the archive. The status on our own public-storage failure is attached to the thrown error as `httpStatusCode` rather than only interpolated, because only a structured field survives the allowlist. **And the redactor itself must never throw**: it runs inside the `catch` that lets `--allow-missing-storage` continue, so it falls back to `unknown` rather than turning one tolerated missing file into a failed export.
- Covered by `scripts/backup/productionArchive.storage.test.ts` — a table over `redactStorageError` plus five `archiveStorage` tests that assert the whole manifest, serialized, contains no internal hostname, bucket name, bare IP or local storage root. Reverting the call site to `error.message` fails all five plus the pre-existing partial-file test, and the fifth — which drives the S3 → public-storage fallback — is additionally the only thing that notices if the `httpStatusCode` attachment is dropped. `MAX_ERROR_CAUSE_DEPTH` is pinned in both directions by a chain that resolves at the cap and one that truncates past it.

<a id="agents-composite-index-column-order-on-statuses-postgresql-18"></a>

### Composite Index Column Order on `statuses` (PostgreSQL 18)

- **Order a composite index so the columns EVERY caller constrains come first.** `statuses_announce_original_actor_idx` is `(type, "originalStatusId", "actorId")` and `20260822000000_reorder_status_announce_index.js` put it that way round deliberately. `20260517000000` had created it as `(type, "actorId", "originalStatusId")`, which serves `getActorAnnounceStatus`, `getActorAnnouncedStatusId` and the batched announce hydration in `getStatusesHydrationContext` — all three pin all three columns, so the order is invisible to them and to every result-based test. It does **not** serve `getRebloggedBy` (`GET /api/v1/statuses/:id/reblogged_by`), which pins `type` and `originalStatusId` and leaves `actorId` free: with `actorId` in the middle, `originalStatusId` cannot become an index condition, so that endpoint bitmap-scanned every Announce row and filtered. Production's plan on 2026-08-22: **8,973 buffers / 18.4 ms, 19,892 rows scanned to return 1**, growing linearly with the Announce count forever. `statusAnnounceIndexOrderMigration.test.ts` reads the index definition rather than asserting the index merely exists, because a revert is functionally identical.
- **Do not rewrite `getRebloggedBy`'s predicate to use `announceOriginalPointer`.** #1493 introduced that helper for the outbox CTE, where the pointer is a **projection** — `case when type = 'Announce' then coalesce("originalStatusId", content) end` — and collapsing the two-branch `OR` there was the whole win. `getRebloggedBy` uses the same two forms as a **predicate**, and `WHERE coalesce("originalStatusId", content) = ?` is an expression over two columns that no plain column index can serve: it would undo this change and put the endpoint straight back to scanning every Announce row. The `OR` form is what lets PostgreSQL build a `BitmapOr` of two index conditions — `(type, "originalStatusId") = ('Announce', $1)` and `(type, "originalStatusId" IS NULL)` — against the reordered index. Unifying the two call sites looks like tidying and is a regression.
- **PostgreSQL 18 will pick an index whose leading column your query does not constrain, and that is usually fine — do not chase it.** This was investigated twice (PR #1468, then again after #1484) before anyone measured the alternative. PG 18's B-tree skip scan makes `(type, …)` a candidate for an `actorId`-only lookup by skipping the three `type` values, and `cost_index` prices the heap I/O from the **leading** column's `correlation`, which a low-cardinality column scores high on for no real reason — production reads `type` at 0.787 against `actorId` at -0.181. So the planner believed the announce index was ~30% cheaper than `statuses_actorId_idx` while it actually read ~5% **more** buffers. That is the whole effect: an `actorId`-only lookup is dominated by heap fetches, which are the same set either way (production: 1,955 of ~2,000 buffers are heap). On a local PostgreSQL 18.6 seeded to production's shape the two came out at 1,911 and 1,902 buffers. Reordering the announce index takes it out of the running as a side effect; it was never the reason to reorder.
- **There is no `enable_indexskipscan` GUC.** PostgreSQL 18.6 exposes no toggle for skip scan (the diagnostics script dumps every `enable_*` setting, and it is not among them), so there is no read-only way to A/B it on a live server. Do not A/B by dropping an index on production either, even inside a transaction you mean to roll back: `DROP INDEX` takes an ACCESS EXCLUSIVE lock and blocks every query on the table until the rollback. Measure it on a local seed instead.
- **`statuses_actorId_idx` (`actorId`, `createdAt`, `updatedAt`) is load-bearing even though plans often name a different index for `actorId` predicates.** It is what the owner's profile timeline (`getActorStatuses` with no visibility filter) scans backward to satisfy `ORDER BY "createdAt" DESC, id DESC LIMIT 30` with `Index Searches: 1` and early termination — 29 buffers on production, against 693 on a seed with the index removed — and what the nodeinfo active-user rollup uses as an index-only scan with `createdAt` as a second index condition. Production has scanned it 3.8 million times since 2026-03-09. Seeing another index in one plan is not evidence it is unused; check `pg_stat_user_indexes.idx_scan` before proposing to drop it.
- **A local seed reproduces row counts and column widths, not statistics.** Match the shape that matters — row count, distinct values per column, average heap bytes per row, and the physical insert order, since scattered inserts are what leave `actorId` uncorrelated — then say "seeded to production's shape", never "reproduced production's plan". The seed for this work matched production to within ~2% on statuses, type mix, distinct Announce originals and heap width, and still put `actorId`'s correlation at 0.002 where production reads -0.181.

<a id="agents-database-compatibility-guidelines"></a>

### Database Compatibility Guidelines

- **All database operations must work with SQLite and PostgreSQL. Only the `better-sqlite3` and `pg` clients are supported; any other client fails at startup.**
- Use a query builder for all database operations (Kysely for new or ported domain code, Knex elsewhere; see **Kysely** below)—avoid raw SQL unless absolutely necessary.
- When writing raw SQL, ensure syntax is compatible across all supported databases.
- Avoid database-specific features unless wrapped with conditional logic or fallback behavior for each backend.
- Test migrations and queries against SQLite (used in tests) to catch compatibility issues early.
- Use standard SQL types and avoid vendor-specific extensions (e.g., use `text` instead of PostgreSQL's `varchar[]`).
- **A client-supplied id compared against a numeric column must be coerced first — PostgreSQL turns a bad id into an error, not a miss.** `medias.id` (and `attachments.mediaId`) are `integer` on PostgreSQL, so `where('medias.id', 'abc')` raises `invalid input syntax for type integer` and a 404 becomes a 500. SQLite's dynamic typing just matches nothing, so the default test run never sees it: `TEST_DATABASE_TYPE=sqlite` is what CI pins, and only `TEST_DATABASE_TYPE=pg` catches this class of bug. In `lib/database/sql/media.ts` every method that **compares** a `mediaId` against `medias.id` runs it through `toMediaRowId` first, so the caller reports "not found" without touching the database. (`createAttachment` **writes** `mediaId` rather than comparing it and is deliberately unguarded, since coercing would silently drop the link instead of surfacing a bad id. The shape check therefore has to sit at the route: `POST /api/v1/accounts/outbox` takes `PostBoxAttachment.id` as a bare `z.string()` and hands it to `lib/actions/createNote.ts`, so a malformed id used to fail the insert on PostgreSQL **after** the status row was committed — a 500, and a published status whose media had silently vanished, because `createNote.ts` opens no transaction to roll back. That route now rejects an id `toMediaRowId` cannot resolve with a 422 before anything is written. Validate at the route rather than in the action: the action runs after the status write, so it is too late to refuse. The id is shape-checked and forwarded unchanged, never normalised — whether the row exists and belongs to the actor stays `resolveAttachmentMediaMetadata`'s question. `POST /api/v1/statuses` and `PUT /api/v1/statuses/:id` never had this hole: they resolve `media_ids` through `getMediaByIdForAccount` and build each attachment from the returned row, so a malformed id resolves to nothing instead of reaching a write. The outbox route is the one that trusts the client's whole attachment object — `url`, `mediaType` and dimensions included — which is why it needs its own guard.) The guard is shape-checked and range-bounded on purpose, not a bare `Number()` — it accepts optional leading zeros, digits, an optional all-zero fraction, and a value in 1..2147483647, and nothing else. Be aware this is deliberately **tighter than the backends themselves**, so on PostgreSQL it is a behaviour change, not only a bug fix: `'0x10'` and `'0b101'` used to resolve media 16 and 5 there (PostgreSQL accepts non-decimal integer literals since 16) and `'+12'`/`' 12 '` used to resolve media 12 on both backends — all now 404, which is the Mastodon answer for something that is not a row id. `'abc'`, `'1e3'`, `'12.0'` and anything above 2147483647 raised `invalid input syntax`/`value out of range` on PostgreSQL and are the 500s being fixed. `'12.0'` is the one spelling kept rather than tightened away, for **SQLite**: `attachments.mediaId` is `varchar` there, so an id bound as a JS number lands as `'1.0'` and gets re-resolved on every status edit. No production writer does that today, so treat it as defence in depth rather than a shim for observed data. Apply the same treatment to any new query that compares a caller-supplied value against a numeric column, and give test fixtures values the column can actually hold.

#### Kysely

The database layer is moving from Knex to Kysely one domain at a time. Knex still runs the migrations and every domain not yet ported.

- **New or ported domain code uses Kysely.** A domain lives in `lib/database/domains/<name>/` as plain query functions `(db: Db, params) => …` (`Db` is the root Kysely instance or a transaction), with its parameter types in `types.ts`; `getSQLDatabase` exposes them through `bindDb(() => kyselyFor(database), queries)` under the unchanged `Database` method names. `lib/database/domains/like/` is the worked example.
- **`kyselyFor(knexOrTrx)`** (`lib/database/kysely/`) returns the Kysely instance that borrows its connections from Knex's pool. Inside an unported Knex transaction, run ported code through `kyselyFor(trx)`: it uses the transaction's connection and commits or rolls back with it. Opening a transaction on it throws (it is already in one); `inTransaction(db, fn)` reuses the transaction it is given or opens one, and `isInTransaction(db)` tells the two apart. A query that turns its own failure into a return value (for example `replayQueueJob` returning `false`) rethrows instead when it runs inside a caller's transaction, so that transaction does not commit half the change.
- **Never use the root instance of one library inside a transaction of the other.** The root Kysely instance inside a Knex transaction, or a root Knex query inside a Kysely transaction, would need a second pooled connection (a deadlock on SQLite's single connection) and would run outside the transaction; both throw `MixedDatabaseTransactionError` instead. The guard follows async context, so it also refuses work started without `await` inside the other library's open transaction (for example `void getDatabase().isActorLikedStatus(…)` inside `knex.transaction`): the other library's root instance is refused while the transaction is open, whether the work was awaited or not. Don't start detached (un-awaited) database work inside a transaction; run it after the transaction resolves (a Knex trx can't be used after commit either). Kysely controlled transactions (`db.startTransaction()`) are refused for the same reason; use `db.transaction().execute(…)`.
- **Results are normalised by the driver** (`lib/database/kysely/normalize.ts`): timestamps read as epoch milliseconds, int8/numeric as numbers, booleans as booleans and JSON parsed, on both backends, so ported code needs no `getCompatibleTime`/`getCompatibleJSON` shims. SQLite expression columns (`count(*)`, `max(…)`) have no declared type and are converted in the domain mapper. Write timestamps as `Date`, compare timestamp columns only through `timestampValue()` (the branded `EpochMs` stops bare numbers, which PostgreSQL rejects, but not read-back values, which must also go through `timestampValue()`), and write JSON as a `JSON.stringify`'d string.
- **Put dialect-specific SQL in `lib/database/kysely/dialect.ts`** and use Kysely's `sql` tag for it there, rather than branching in a domain (for example `forUpdate()`, which is a no-op on SQLite where Kysely would emit `for update`).
- `jsonText(db, column, key)` in `dialect.ts` reads a string property of a JSON column (`json_extract` on SQLite, `::jsonb ->> key` on PostgreSQL), NULL when the column or the property is missing; `key` is spliced in as a literal, so it must be a fixed property name.
- `fullTextMatch(db, query, tokens)` in `dialect.ts` keeps the `search_documents` rows whose text contains every token as a word prefix: SQLite joins the FTS5 table `search_documents_fts` on `rowid` and matches `token*`, PostgreSQL matches the `to_tsvector('simple', "documentText")` expression the GIN index is built on, so keep the two spellings in step with the index migration.
- `normalizedHashtagName(db, column)` in `dialect.ts` is a stored hashtag name without its leading `#`s, lowercased (`ltrim` on SQLite, `trim(leading '#' from …)` on PostgreSQL), so `#name` rows and legacy bare `name` rows group as one name.
- `hashtagsOnPublicStatuses(db)` (`lib/database/domains/search/hashtags.ts`) selects the hashtag rows of publicly addressed Notes and Polls joined to their status; hashtag search, featured tags and trends all build on it so they count the same rows.
- `potentiallyReadableStatus(db, eb, viewerId)` (`lib/database/kysely/visibility/potentiallyReadable.ts`) is the Kysely twin of the Knex `applyPotentiallyReadableStatusFilter`; change both together, since `visibilityEquivalence.test.ts` runs them over the same rows and expects the same statuses.
- `isLocalActor` (`lib/database/kysely/visibility/localActor.ts`) is the Kysely twin of `whereLocalActor`: a non-null, non-empty `privateKey`.
- **A ported domain that needs an unported domain's facade method takes it injected, and calls it only outside its own transactions.** The direct conversation domain hydrates statuses through the Knex status facade: `getSQLDatabase` binds `createConversationQueries(statusDatabase)` (`lib/database/domains/conversation/queries.ts`), and only the reads call `getStatusesByIds`, after their queries, never inside `syncDirectConversationForStatus` or `markDirectConversationRead`'s transaction (the root Knex call there would trip the transaction guard).
- **Regenerate `lib/database/kysely/db.ts` whenever a migration changes the schema** (see [Regenerating the Kysely DB types](setup.md#regenerating-the-kysely-db-types)).
- **Kysely supports better-sqlite3 and pg only, and so does the app.** `lib/database/index.ts` refuses any other client (`mysql`, `mysql2`, `sqlite3`, `pg-native`) when the database is first created, naming the driver, so a misconfiguration fails at startup instead of on the first like query.
- Counters in ported code go through `lib/database/kysely/counter.ts` (one atomic upsert per adjustment, `getCounterValues` for several ids in one statement); the Knex helpers in `lib/database/sql/utils/counter.ts` remain for unported domains.
- Hour-bucket counters in ported code (`bucket:<type>:<YYYYMMDDHH>` rows with a `bucketHour`) go through `incrementBucket` and `getBucketStats` in `lib/database/kysely/counterBucket.ts`; the Knex `incrementBucket` in `lib/database/sql/utils/counterBucket.ts` remains for unported domains.
- **Big `IN` lists and multi-row inserts go through `lib/database/kysely/inList.ts`** (`selectInChunks`, `insertInChunks`), which use the same batch sizes as the Knex `getWhereInBatchSize`/`getInsertBatchSize`, so one statement stays under SQLite's 999 bound values.
- **A statement whose failure the code catches inside a transaction (a unique violation to skip) runs in `inSavepoint(trx, fn)`** (`lib/database/kysely/savepoint.ts`). PostgreSQL aborts the whole transaction when any statement fails, SQLite does not, so a bare `try`/`catch` passes the SQLite run and breaks every later statement on PostgreSQL.
- **Delete sessions through `deleteSessionsWithTokenDetach(db, scope)`** (`lib/database/domains/account/sessions.ts`) rather than a bare `deleteFrom('sessions')`. It nulls `sessionId` on the OAuth access and refresh tokens of the doomed sessions first (the columns reference `sessions.id` with no `ON DELETE` action, so PostgreSQL refuses the delete otherwise) and keeps both steps in one transaction. The Knex twin in `lib/database/sql/utils/detachOAuthTokensFromSessions.ts` stays for the better-auth adapter; both use `SESSION_ID_CHUNK_SIZE`, and `sessionTokenDetach.test.ts` runs them against the same rows and compares the tables. `deleteAllAccountSessions` and `rejectPendingAccount` (moderation domain) still delete sessions directly, as the Knex code did, so they fail while a session of the account still carries tokens.
- **Username lookups in ported code go through `findActorRowByUsername` in `lib/database/kysely/usernameMatch.ts`**: the exact `(username, domain)` row first, then the `lower(username)` arm (backed by the functional index) ordered by `createdAt, id`. It has no MySQL branch, since Kysely runs on better-sqlite3 and pg only. The Knex one in `lib/database/sql/utils/usernameMatch.ts` remains for `getActorFromUsername`.

<a id="review-uploaded-file-names"></a>

### Review: Uploaded file names

- A supplied file name (`File.name`, the presigned flows' `fileName`) is
  attacker-controlled: only browser multipart uploads send a bare basename. In
  the upload storage drivers (`lib/services/medias/`,
  `lib/services/fitness-files/`) it must never be joined to a path, passed to
  `extname`, or persisted raw — it goes through `@/lib/services/medias/fileName`
  first. `medias.originalFileName` and `fitness_files.fileName` are both
  `varchar(255)`, so an over-long name is also a PostgreSQL insert failure.
- Temp paths from a supplied name use `createMediaTempFilePath` (random prefix,
  explicit separator, parent asserted to be `tmpdir()`), never
  `join(tmpdir(), prefix + name)` — `path.join` resolves `..`, and prepending a
  prefix without a separator does not stop it: enough `..` still escapes, and
  fewer cancel the prefix out into a predictable path.
- A generated path's extension comes from the validated content type via
  `getStoredMediaExtension()`, not from the name. Every `ACCEPTED_FILE_TYPES`
  entry needs a mapping in `EXTENSION_BY_CONTENT_TYPE`, or it falls through to
  the name.
- A video's preview frame is extracted through the shared
  `extractVideoPreviewFrame` (`medias/videoPreview`) **before** the video is
  stored, never from the stored file: `extractVideoImage` rejects when ffmpeg
  finds no decodable frame, and a stored file with no `medias` row is
  unreachable by everything except `scripts/maintenance/cleanupMediaStorage.ts`.
  Its temp copy goes through `createMediaTempFilePath` like any other, but the
  name it hands over is the server-derived `video<ext>` (so the path is
  `<random prefix>-video<ext>`) and takes nothing from the supplied name —
  ffmpeg picks its demuxer from the path too, and `image2` beats content probing
  for an image extension carrying a `%0Nd` or `*` pattern, so `IMG_%04d.jpg` on
  a valid mp4 turned a storable upload into a 500. Validate the container from
  the probe first, so an audio-only mp4 stays a 422 that never spawns ffmpeg.

<a id="review-unique-constraints-toctou"></a>

### Review: Unique constraints (TOCTOU)

- Pre-checking uniqueness (email/username exists?) before an insert/update is a
  Time-of-Check to Time-of-Use race: concurrent requests slip past the check and
  hit a DB unique-constraint violation that surfaces as a 500.
- Wrap the write and catch the specific violation (e.g. `isUniqueConstraintError`),
  mapping it to a `422 Unprocessable Entity` instead of letting the raw DB error
  propagate. The pre-check is a UX nicety; the caught violation is the guarantee.
- When a write can violate several unique constraints (multi-column / multi-table
  inserts), identify the offending field by re-running the existence checks — do
  not parse backend-specific constraint names or messages, which differ across
  SQLite and PostgreSQL.

<a id="review-database-migrations"></a>

### Review: Database & migrations

- Queries use a query builder (Kysely in new or ported domains, Knex
  elsewhere), not raw SQL, unless unavoidable. Operations must work on SQLite
  (tests + local dev) and PostgreSQL (the only supported clients). Use standard SQL types (e.g. `text`, not `varchar[]`). Ported code
  never mixes the root Knex and Kysely instances inside one transaction (use
  `kyselyFor(trx)`); see [Kysely](#kysely).
- Any PR that adds/edits/removes a migration regenerates **both**
  `migrations/schema.sql` (PostgreSQL) and `migrations/schema.sqlite.sql` (SQLite)
  in the same PR, against fresh local DBs — never hand-edited — and then
  `lib/database/kysely/db.ts`. Commit a schema-only regeneration as `none:`. (CI's SQLite and PostgreSQL Schema Dump Sync
  jobs catch schema-dump and Kysely-type drift.)
- The viewer's own follow row is read with `getViewerFollow`
  (`lib/services/getViewerFollow.ts`) on **read** paths — it is
  `cache()`d, so a profile render resolves it once instead of once per call site
  — and with `database.getAcceptedOrRequestedFollow` everywhere else. Its
  arguments are positional because `cache` keys on argument identity; an options
  object memoizes nothing. Never route a **mutating** route's own pre-mutation
  read through it: follow, unfollow, block and follow-request
  authorize/reject read the row, change it, then report the result, so a value
  cached from before their write would describe the state they replaced.
- "Is this actor local?" is `whereLocalActor`
  (`lib/database/sql/utils/localActor.ts`), never a hand-written
  `whereNotNull('privateKey')`. Legacy rows store `privateKey = ''` for REMOTE
  actors, so a null-only check counts them as local — it did for 216 of 221 rows
  on production. In JS the test is `Boolean(actor.privateKey)`, never
  `actor.privateKey !== ''`: the row mapper drops the field when falsy, so that
  comparison is always true and filters nothing. Note `.modify()` returns
  `QueryBuilder<any, any>` — name the row type on the `select` if the rows are
  consumed as a typed shape.
- The local public timeline passes local actor ids in as literal values and must
  not join `actors`. Joining on that unique key collapses the planner's estimate
  and loses `LIMIT` early termination at every page size once the `<> ''`
  predicate is present (on a local seed matching production's shape, 176
  buffers vs ~16,700 at a page of 30, and the join is no better at 23). The id fetch carries an explicit `LIMIT` of one past
  what the query can bind — it runs on an anonymous path, which is why the bound
  is required, not what supplies it.
- A new composite index orders its columns so the ones **every** caller
  constrains come first. A column that only some callers pin belongs last:
  anything after an unconstrained column cannot become an index condition, and
  the query silently degrades to scanning the whole leading-column range.
  `statuses_announce_original_actor_idx` is `(type, "originalStatusId",
"actorId")` for exactly that reason — `getRebloggedBy` leaves `actorId` free.
  Because the callers that pin all three columns behave identically under either
  order, a functional test cannot see the difference; assert the index
  definition itself (`statusAnnounceIndexOrderMigration.test.ts`).
- PostgreSQL 18 naming an index whose leading column the query does not
  constrain is not by itself a finding. Skip scan makes it a candidate and
  `cost_index` prices heap I/O off the leading column's correlation, which
  low-cardinality columns score high on spuriously — but the heap fetches
  dominate and are the same either way. Measure the alternative on a local seed
  before proposing anything; there is no `enable_indexskipscan` GUC, and never
  A/B it by dropping an index on production.
- A caller-supplied id compared against a **numeric** column is coerced first.
  `medias.id` and `attachments.mediaId` are `integer` on PostgreSQL, so passing a
  non-numeric client string raises `invalid input syntax for type integer` — a
  500 where a 404 was intended. SQLite's dynamic typing just misses, so only
  `TEST_DATABASE_TYPE=pg` catches it. `lib/database/sql/media.ts` routes every
  `mediaId` it **compares** against `medias.id` through `toMediaRowId`.
  It accepts only optional leading zeros, digits, an optional all-zero
  fraction, and 1..2147483647. That is deliberately tighter than the backends:
  on PostgreSQL `'0x10'`/`'0b101'` resolved rows 16/5 (it takes non-decimal
  integer literals since 16), and on both backends `'+12'`/`' 12 '` resolved
  row 12 — all now 404, which is intended, since a media id is a row id.
  `'12.0'` is kept only because SQLite's `varchar` `attachments.mediaId` can
  hold that form. New numeric-column lookups do the same, and fixtures use
  values the column can hold.
- `createAttachment` **writes** `mediaId` rather than comparing it and is
  deliberately unguarded — coercing would drop the link instead of surfacing a
  bad id. Its callers must therefore hand it an id already resolved against
  `medias`. `POST /api/v1/accounts/outbox` does not (its `PostBoxAttachment.id`
  is a bare `z.string()`), so a malformed id there fails the insert on
  PostgreSQL after the status row is committed — a known open bug, separate
  from the lookup guard.
- A per-column type difference between the two schema dumps is not automatically
  drift — a backend-conditional migration (e.g.
  `20260207223000_fix_attachments_media_id_type.js`, PostgreSQL-only) makes them
  legitimately differ. Read the migration before asking for a regeneration.
- Better-auth plugins are only registered once their required tables exist in a
  migration; admin/dashboard plugins are gated with explicit access control.
- Cursor-based pagination: pass the raw cursor row (with its stored representations,
  e.g. a `Date`) to the query builder's cursor helper rather than pre-normalizing
  it (e.g. to a millisecond `number`), so it matches the column's backend
  representation. When resolving a cursor record by id, don't filter the lookup by
  mutable status fields (`pending`, `requested`, …) — the row must still resolve if
  its status changed between page requests.
- Mastodon pagination: `since_id` and `min_id` are not interchangeable —
  `since_id` returns the newest band above the cursor (descending), `min_id` the
  oldest band immediately after it (ascending, then reversed). Order each query
  accordingly.
- Idempotency-key storage uses `.onConflict().ignore()`, not `.merge()`, so the
  first stored resource id is preserved when a request is retried.

<a id="review-stored-media"></a>

### Review: Stored media

- Stored-image pipelines are built with `createStoredImagePipeline`
  (`lib/services/medias/storedImagePipeline.ts`), never an inline
  `{ fit: 'inside' }` chain (the helper sets `withoutEnlargement`). sharp's
  `fit: 'inside'` **enlarges** by default, so a bare `MAX_WIDTH`/`MAX_HEIGHT`
  box is an upscale, not a cap — it inflates every stored image below the cap,
  silently, with no error and no test failure.
- A stored image carries **no EXIF** — never add `keepExif()`/`keepMetadata()`
  to the encode. The stored file is public, and an API or Mastodon-client
  upload's EXIF is its GPS position and device. Orientation is applied by the
  pipeline's `.rotate()` before the metadata is dropped.
- A sharp call that decides whether input is usable is a **pipeline output**
  (`toBuffer`/`toFile`), never `stats()`, and it decodes through the encode's
  own input chain (`createStoredImagePipeline`) so it rejects exactly what the
  encode would. sharp learns why libvips failed from one process-wide error
  buffer that every sharp call clears as it finishes, so with other sharp work
  in flight a failure can arrive with no message. The pipeline rejects anyway;
  `stats()` resolves with an empty `channels` instead. `readValidThumbnail`
  gated on `stats()` and passed truncated PNGs under concurrent load — each then
  failed in the encode as a 500, not a 422 — while every serial test refused
  them.
- `original.metaData`/`original.bytes` describe the **uploaded** file, while
  `thumbnail.*` describes the **stored** WebP (`outputInfo`). Know which one a
  change reads: only the latter moves when the encode pipeline changes, and only
  the latter feeds `meta.small`.
- **The two storage drivers must answer the same input identically.**
  `LocalFileStorage` and `S3FileStorage` are edited one at a time and drift
  silently — an uploaded `thumbnail` was stored by one and dropped by the other
  for as long as both existed, so the same upload answered with a different
  `meta.small`/`preview_url` per backend. That divergence now reaches every
  client reading the status, not just the upload response: an attachment row
  snapshots `thumbnailUrl` (resolved off `meta.small`) and
  `getMastodonAttachment` serves it as `preview_url`. Only federation is still
  blind to it — the AP `Document` has no thumbnail field. Shared policy belongs in a
  module both import
  (`medias/thumbnailInput` validates a supplied thumbnail; `medias/fileName`
  handles supplied names), and a change to one driver's `saveFile` needs the
  matching test in **both** `localFile.test.ts` and `S3StorageFile.saveFile.test.ts`.
- **A `/api/v1/files/` URL is only ours if its HOST says so — parse it with
  `getMediaPathFromFileUrl` (`lib/services/medias/mediaFileUrl`), never a bare
  path prefix check.** That route is this project's own, so every other
  activities.next instance serves its attachment URLs under exactly the same
  path. Matching on the path alone reads a remote instance's URL as a local
  storage path, which then misses in storage and — where the caller treats
  "not local" as "fetch it over HTTP instead" — skips the branch that would
  have retrieved the file correctly. The host question itself is
  `isOwnInstanceHost` (`lib/utils/host`), which covers `ACTIVITIES_TRUSTED_HOSTS`
  (a multi-domain instance mints media URLs on the OWNING actor's domain) and
  loopback development hosts, which `isHostTrustedByRules` alone rejects.
  `getAttachmentMediaPath` is not this check: it never returns null and is for
  URLs this instance just produced.
- **The path it recovers must also be refused when it walks upwards, is
  absolute, or carries a NUL byte — and that check runs AFTER decoding**
  (`isTraversingStoragePath`, shared with the blurhash backfill; do not fork
  it). `new URL()` resolves dot segments only where the separators are literal
  slashes, so `https://<our-host>/api/v1/files/..%2f..%2fsecrets/env` reaches
  the decoder still spelled `..%2f` and comes back as `../../secrets/env`; the
  host-relative branch parses no URL at all, so a plain
  `/api/v1/files/../../secrets/env` is never normalised either.
  `copyProfileImage` joined that onto the staging directory and copied whatever
  it found into the archive as `avatar.<ext>`, and `iconUrl` is a bare
  `z.string()` any signed-in user can set — so this was a live arbitrary-file
  read, not a hardening exercise. Refuse only a segment that RESOLVES to `..`:
  `ab/..cd.webp` is an ordinary stored file name. Cover Windows too — `\` is a
  separator, `C:` is absolute, and Win32 strips a component's trailing dots and
  spaces carrying two or more dots, since Windows normalises trailing dots away
  and Node's own `path.win32` does not model that. Refusing the whole shape is
  deliberately wider than what Win32 actually collapses — no stored path is
  named out of dots, so over-refusing costs nothing and does not depend on
  getting the platform's rules exactly right.
- **Do not answer "the storage driver will reject it".** `LocalFileStorage.getFile`
  does make a containment check; `S3FileStorage.getFile` only refuses a key
  outside the `medias/` prefix — inside it a traversing key is merely inert,
  and with a CDN `hostname` configured it is string-concatenated into a
  redirect URL. Any new step that turns a stored
  path into a filesystem read should still resolve and confirm containment for
  itself, the way `copyProfileImage` and `createMediaTempFilePath` do — a
  signature taking a bare path says nothing about where the path came from.
- **A wildcard trusted-host entry is not a literal authority, and the check
  belongs AFTER parsing.** `new URL()` accepts `*` in a host, so an
  exact-authority comparison against the rule's own spelling let
  `https://*.cdn.example/api/v1/files/<path>` pass as ours. Both of
  `isOwnInstanceHost`'s passes need a guard: the exact pass reads RAW rules so
  it skips any rule containing `*`, and `normalizeHost` — which recognised the
  documented `*.example.com` form only on the raw value, leaving `*example.com`,
  `cdn.*` and `foo.*.example.com` as literal hostnames a `%2a`-spelled
  authority matched exactly — now refuses any parsed hostname still containing
  one, reading the `*.` marker off the AUTHORITY so a scheme-prefixed rule
  still expands.
- **Three consumers of `ACTIVITIES_TRUSTED_HOSTS` apply that refusal, each on
  the PARSED hostname** — `normalizeHost`, `buildTrustedOrigins` and
  `toHostname` — because each reads a misplaced wildcard differently. A fourth,
  `isOwnAuthority` in the blurhash backfill, was deleted by #1570: that sweep
  asks `isOwnInstanceHost` now and inherits its guards. `buildTrustedOrigins` hands it to
  better-auth, which globs any pattern containing `*`, so `*example.com`
  trusted `evilexample.com` for the auth Origin check and for
  `callbackURL`/`redirectTo` — an open redirect carrying auth callbacks.
  **Check after parsing, never before: the parser is what MAKES the `*`.** It
  percent-decodes the authority, applies IDNA mapping and strips tab/CR/LF, so
  `%2aexample.com` and a fullwidth `＊example.com` sail past a raw check — which
  buys nothing anyway, since a literal `*example.com` parses to a hostname
  carrying the same `*`. Where a guard reads `hostname` but emits `origin`, it
  must also require a web scheme: `blob:` derives its origin from the inner URL
  in its PATH and reports an empty host, the one scheme where the two disagree.
  `getAllowedOrigins` in the Apple Maps token route is a fifth consumer that
  deliberately does not filter — whether MapKit globs `*` is unverified, so
  establish that before sweeping it.
- **A stored path is confined to the storage root by
  `resolveStorageFilePath` / `assertStorageFilePath`
  (`lib/services/medias/storagePath`), on every filesystem path a local driver
  builds — read, delete and write alike.** A bare `path.resolve(root, filePath)`
  walks out of the root given `../` or an absolute path, and the escape is
  silent: the read or the unlink lands somewhere else on disk. Watch for the
  read-only variant of this — `LocalFileStorage.getFile` carried the check while
  `deleteFile` beside it had none, which made containment an invariant of the
  callers rather than of the driver. `resolveStorageFilePath` returns null (and
  logs the refusal); `assertStorageFilePath` throws, for a write with nothing
  sensible to return. Object storage is a different question: an S3 key has no
  filesystem root to escape.
- **Reject a hand-rolled containment check, and reject `startsWith` against a
  bare resolved root.** `fullPath.startsWith(path.resolve(base))` has no
  separator boundary, so a sibling directory whose name the root prefixes passes
  it — root `/srv/uploads` accepts `/srv/uploads-backup/x`. That form guarded an
  `fs.unlink` in `scripts/maintenance/cleanupMediaStorage.ts`, and it reads as
  correct at a glance. Two Oxlint rules in `lint/agentsRules.mjs` now decide
  this on the AST: `agents/no-storage-path-builder` in the two local drivers and
  `agents/no-resolved-path-prefix-check` everywhere, `scripts/**` included via
  the second `yarn lint` pass. Because they resolve names through scope, a
  renamed import, a destructured `resolve`, `path['resolve']`, `path?.resolve`
  and a root pulled into a variable first are all caught — so what is left for a
  reviewer is narrower and worth knowing: a helper that resolves on a driver's
  behalf, a path built by string concatenation, and a binding imported from
  another module. Do not answer any of those with a raw-text Vitest scan; that
  is what these rules replaced, and it was wrong in both directions. **Treat an
  `oxlint-disable` comment naming either rule as a finding in itself** — a lint
  rule can be silenced with a comment where the text scan could not be, and
  nothing reports that the suppression was used. Note the
  check is lexical either way: a symlink planted under a storage root defeats
  it, which is a documented residual, not something to paper over at the call
  site.
- **A stored file with no `medias` row is unreachable**, so whatever fails
  after a write must reclaim it — only `scripts/maintenance/cleanupMediaStorage.ts`
  can find it otherwise. Equally, do not report a storage failure as a
  `MediaValidationError`: that is a 422 the client will not retry, and
  `handleSyncMediaUpload` deliberately logs nothing for it. Validate input
  first, then let a genuine fault stay a logged 500.
- **A blurhash is the one media field a remote actor supplies directly, and
  `normalizeBlurhash` (`lib/services/medias/imageAnalysis.ts`) decides its
  stored form.** It returns the string to persist or null, never a boolean,
  because it trims before deciding: the predicate it replaced validated
  `hash.trim()` while `createNoteJob` stored the untrimmed original, so a padded
  hash from a federated note was persisted in a form `decode` throws on and
  re-served to clients verbatim. Reject any new caller that tests the value and
  then stores its own argument. Both halves of the check are load-bearing —
  `BLURHASH_REGEX` covers the base83 alphabet `isBlurhashValid` ignores, and
  `isBlurhashValid` covers the structure the regex cannot see, that the length
  must be `4 + 2 * componentX * componentY` for the size flag in the value's own
  first character, which is why `'aaaaaa'` is legal base83 of a legal length and
  still throws.
