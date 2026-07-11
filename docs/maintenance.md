# Maintenance Scripts

This guide covers maintenance and administrative scripts available in Activity.next.

## Media Storage Cleanup

The `cleanupMediaStorage.ts` script helps you clean up orphaned media files that are no longer referenced in the database. This is useful for reclaiming storage space after content deletion or database recovery.

### What it does

The script:

1. Connects to your database and retrieves all media file paths
2. Lists all files in your configured storage (local filesystem or S3)
3. Identifies files that exist in storage but are not referenced in the database
4. Optionally deletes these orphaned files

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

## Other Scripts

### Create Mock User

Creates a test user for development/testing:

```bash
./scripts/mock/createMockUser.ts [username] [email] [password]
```

> **Note:** This script is for development and testing purposes only. In production, users should register through the web interface at `/auth/signup`.

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
NODE_ENV=production ./scripts/fitness/cleanupLegacyFitnessHeatmaps.ts
NODE_ENV=production ./scripts/fitness/repairStravaActivityFiles.ts --actor-id https://your-domain.tld/users/username --dry-run
NODE_ENV=production ./scripts/fitness/retrigerStravaActivities.ts --actor-id https://your-domain.tld/users/username --activity-id 123456789
NODE_ENV=production ./scripts/fitness/listStravaWebhooks.ts @username@your-domain.tld
```

> **Note:** `fixStuckFitnessProcessing.ts` has no dry-run/preview mode — it updates stuck files immediately (it also supports a `--status-hash <64-char-hex>` mode instead of `--actor-id`).

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
NODE_ENV=production ./scripts/maintenance/fixAttachmentUrls.ts --dry-run
NODE_ENV=development ./scripts/mock/createMockStatuses.ts
```

## Related Documentation

- [Setup Guide](setup.md) — Initial setup and configuration
- [Environment Variables](environment-variables.md) — Complete configuration reference
- [SQLite Setup](sqlite-setup.md) — SQLite-specific setup and backups
- [PostgreSQL Setup](postgresql-setup.md) — PostgreSQL-specific setup and backups
