# Maintenance Scripts

This guide covers maintenance and administrative scripts available in Activity.next.

## Media Storage Cleanup

The `cleanupMediaStorage` script helps you clean up orphaned media files that are no longer referenced in the database. This is useful for reclaiming storage space after content deletion or database recovery.

### What it does

The script:

1. Connects to your database and retrieves all media file paths
2. Lists all files in your configured storage (local filesystem or S3)
3. Identifies files that exist in storage but are not referenced in the database
4. Optionally deletes these orphaned files

### Usage

```bash
# Preview what would be deleted (recommended first step)
./scripts/cleanupMediaStorage --dry-run

# Clean up with interactive confirmation
./scripts/cleanupMediaStorage

# Clean up without confirmation (use with caution!)
./scripts/cleanupMediaStorage --yes

# Show help
./scripts/cleanupMediaStorage --help
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
./scripts/cleanupMediaStorage --dry-run

# Perform cleanup with confirmation
./scripts/cleanupMediaStorage
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
./scripts/cleanupMediaStorage --dry-run

# Perform cleanup without confirmation
./scripts/cleanupMediaStorage --yes
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
./scripts/createMockUser [username] [email] [password]
```

See the [Setup Guide](setup.md) for more information on initial setup and configuration.
