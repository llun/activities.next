# Maintenance Scripts

This guide covers maintenance and administrative scripts available in Activity.next.

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
- `--fetch-remote-attachments` — download attachments hosted on other servers
  into the archive too (by default their absolute URL is kept as-is, since
  the export only owns the actor's own storage)

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

## Other Scripts

### Create Mock User

Creates a test user for development/testing:

```bash
./scripts/mock/createMockUser.ts [username] [email] [password]
```

> **Note:** This script is for development and testing purposes only. In production, users should register through the web interface at `/auth/signup`.

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

### Fitness and Strava Maintenance

Useful scripts for interrupted imports, route heatmap rebuilds, and Strava maintenance:

```bash
NODE_ENV=production ./scripts/fitness/fixStuckFitnessProcessing.ts --actor-id https://your-domain.tld/users/username
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
> **Note:** `recreateFitnessRouteHeatmaps.ts` soft-deletes the actor's heatmap rows and queues a generation job per variant and region, each rebuilding its own row on its own clock. Only the all-activities/all-time row also rebuilds that actor's **tile pyramid** — what the interactive maps and the share image draw street-level detail from — so a rebuild is heavier than the queued-job count suggests. While that pyramid is `generating` rather than `completed`, nothing serves tiles at all: a row already rebuilt draws its stored geometry, and street-level detail returns only once the build stamps itself completed. A row soft-deleted and not yet rebuilt has nothing to serve, so a share token pointing at one answers 404 until its own job finishes.
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
status (an orphaned file — visible under "Your Fitness Files" with no matching
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
  --activity-id 123456789 [--activity-id ...] [--visibility public] [--dry-run]
```

Passing several `--activity-id`s at once groups them by same-ride overlap (≥80%
on start+duration), so one ride recorded as two Strava activities merges into a
single post instead of duplicates. To consolidate existing duplicate posts,
delete them first (deleting a status detaches its files back to orphans), then
re-run with all the activity ids.

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

Additional utility scripts:

```bash
NODE_ENV=production ./scripts/maintenance/backfillMediaBlurhash.ts --dry-run
NODE_ENV=production ./scripts/maintenance/fixAttachmentUrls.ts --dry-run
NODE_ENV=development ./scripts/mock/createMockStatuses.ts
```

## Blurhash & Smart Focus Backfill

The `backfillMediaBlurhash.ts` script scans existing `medias` and `attachments` records that lack a `blurhash` or focal point coordinates, computes them from stored files / URLs, and updates the database. It also fills in a missing `attachments.thumbnailUrl` from the linked `medias` row.

### Usage

```bash
# Preview what would be updated without writing to the database
NODE_ENV=production ./scripts/maintenance/backfillMediaBlurhash.ts --dry-run

# Run backfill on missing rows in batches of 50
NODE_ENV=production ./scripts/maintenance/backfillMediaBlurhash.ts --batch-size 50

# Recompute the blurhash even on rows that already have one
NODE_ENV=production ./scripts/maintenance/backfillMediaBlurhash.ts --force

# Never fetch a remote attachment URL — only read files this instance stores
NODE_ENV=production ./scripts/maintenance/backfillMediaBlurhash.ts --local-only
```

### Repairing thumbnail URLs written by earlier versions

Earlier versions of this script wrote `attachments.thumbnailUrl` as a host-relative path (`/api/v1/files/…`). That value is served to clients verbatim as Mastodon's `preview_url` and as a `<video>` poster, so it is unusable to any client not talking to this origin. A normal run now selects and repairs those rows as well as rows missing a blurhash — no flag needed — and rewrites them to the absolute URL the live upload path produces, on the owning actor's domain. An already-absolute value is left alone.

### Attachments whose `mediaId` resolves to nothing

Deleting a media file from **Settings → Media Storage** removes the `medias` row and its stored bytes, but leaves `attachments.mediaId` on any post that used it pointing at the row that is gone. That is intended — a `NULL` `mediaId` is how a federated attachment is stored, so clearing it would make the attachment un-removable by editing the post.

Such a row cannot be repaired from its media: the BlurHash, focal point and `thumbnailUrl` all come from the linked `medias` row, and `thumbnailUrl` has no other source. Because a host-relative `thumbnailUrl` keeps matching the selection predicate, the row is re-read on every run. The script warns for each one and reports two separate counts:

```text
[attachments 0f3c…] media 412 no longer exists; cannot restore blurhash, focus or thumbnailUrl from it
[attachments 91ab…] mediaId "wat" is not a media row id; cannot restore blurhash, focus or thumbnailUrl from it
Attachments complete: processed 1204, updated 6, 37 whose media row is gone, 2 with an invalid mediaId
```

The two are never summed, because they mean different things:

- **`whose media row is gone`** — a real row id whose `medias` row was deleted. Not an error to act on; it is the residue of owners deleting their own media. The author can drop the leftover attachment by editing the post.
- **`with an invalid mediaId`** — a value that was never a row id at all. Nothing was deleted here, so this is a bad **write** and is worth investigating. `createAttachment` does not validate `mediaId` (deliberately, so a bad id surfaces instead of being silently dropped) and `POST /api/v1/accounts/outbox` reaches it with an unvalidated attachment id. PostgreSQL rejects that insert because `attachments.mediaId` is `integer`; SQLite stores it, so a non-zero count here is expected only on SQLite-backed instances.

Neither count partitions `processed`. A warned row can still appear in `updated`: the script falls back to analysing the image behind the attachment's own `url`, which usually still exists for an invalid `mediaId` precisely because nothing was deleted.

### What `--force` does, and does not, recompute

`--force` recomputes the **blurhash**, and re-derives `thumbnailUrl` from the linked `medias` row even when the stored value is already absolute. It does **not** recompute a **focal point** that is already stored: `PUT /api/v1/media/:id` lets an owner set one by hand, and no column records whether a stored point was set that way or detected automatically, so recomputing would silently discard the owner's choice. A missing focal point is still filled in, with or without the flag.

### Remote attachment URLs

An attachment federated to this instance carries a URL its remote author chose, so the script treats it as untrusted input reached from inside the deployment. Before any such URL is fetched it must be HTTPS, carry no credentials, and resolve to a public address — a URL naming the local network is skipped. **Every redirect hop is re-checked the same way**, because a public host answering `302` with a private `Location` would otherwise send the request somewhere the first check never saw; a chain longer than three hops is abandoned. The response must declare an `image/` content type, and the body is capped at 10 MB. Pass `--local-only` to skip these downloads entirely and backfill only from files this instance stores.

A URL is treated as local storage only when its host is this instance's own — `ACTIVITIES_HOST` or one of `ACTIVITIES_TRUSTED_HOSTS`, wildcard entries such as `*.example.com` included, matched the same way a request's `Host` header is. Every other activities.next instance serves attachments under the same `/api/v1/files/` path, so the host is what tells the two apart. A path that walks upwards once decoded is refused rather than handed to storage.

## Related Documentation

- [Setup Guide](setup.md) — Initial setup and configuration
- [Environment Variables](environment-variables.md) — Complete configuration reference
- [SQLite Setup](sqlite-setup.md) — SQLite-specific setup and backups
- [PostgreSQL Setup](postgresql-setup.md) — PostgreSQL-specific setup and backups
