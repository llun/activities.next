#!/usr/bin/env -S node scripts/run.cjs
/**
 * Script to clean up media files that are not referenced in the database
 * Usage: scripts/maintenance/cleanupMediaStorage [--dry-run] [--yes]
 *
 * Options:
 *   --dry-run   Show what would be deleted without actually deleting
 *   --yes       Skip confirmation prompt and delete immediately
 */
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  type S3Client
} from '@aws-sdk/client-s3'
import { realpathSync } from 'fs'
import fs from 'fs/promises'
import knex from 'knex'
import path from 'path'

import { getConfig } from '@/lib/config'
import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import {
  type MediaStorageConfig,
  MediaStorageType
} from '@/lib/config/mediaStorage'
import { getEffectiveFitnessStorageConfig } from '@/lib/services/fitness-files'
import { createStorageS3Client } from '@/lib/services/storage/s3Client'

async function getAllMediaPathsFromDatabase(
  basePath?: string
): Promise<Set<string>> {
  const config = getConfig()
  const database = knex(config.database)

  try {
    const paths = new Set<string>()
    // Stored paths are already relative to the storage root, which is what
    // listLocalFiles/listS3Files return, so they are comparable as-is. Only an
    // absolute value needs rebasing — applying path.relative unconditionally
    // resolved a relative path against the CWD instead, producing a
    // `../../…` string that matched nothing, so every file in local storage
    // was reported as orphaned and `--yes` would have deleted all of it.
    const addPath = (value: unknown) => {
      if (typeof value !== 'string' || !value) return
      paths.add(
        basePath && path.isAbsolute(value)
          ? path.relative(basePath, value)
          : value
      )
    }

    // Get all media paths from the medias table
    const medias = await database('medias').select('original', 'thumbnail')
    for (const media of medias) {
      addPath(media.original)
      addPath(media.thumbnail)
    }

    // Fitness route maps keep a JPEG copy for the activity-import email, which
    // lives in media storage but deliberately has no `medias` row — the
    // fitness file is its only reference. Without this it looks orphaned, and
    // this script would delete a file the database still points at.
    // Only LIVE rows count as references. A soft-deleted row keeps its column
    // values, and the delete paths already remove the file, so counting them
    // would make anything they missed unreclaimable forever.
    const fitnessFiles = await database('fitness_files')
      .whereNull('deletedAt')
      .select('mapImageEmailPath')
    for (const fitnessFile of fitnessFiles) {
      addPath(fitnessFile.mapImageEmailPath)
    }

    return paths
  } finally {
    await database.destroy()
  }
}

// macOS and Windows fold case in path lookups, so two spellings can name the
// same file or directory.
const isCaseInsensitiveFilesystem = () =>
  process.platform === 'darwin' || process.platform === 'win32'

const toRealPath = (target: string) => {
  try {
    return realpathSync(target)
  } catch {
    return target
  }
}

/**
 * `path.relative`, but tolerant of a case-insensitive filesystem.
 *
 * macOS and Windows treat `/data/Media` and `/data/media` as one directory, so
 * a fitness root that differs from the media root only by case really does sit
 * inside the listing — while plain `path.relative` reports `../media/...` and
 * would let the caller conclude the two are unrelated. For a tool that deletes
 * files, guessing "unrelated" is the expensive direction to be wrong in.
 *
 * Returns a path relative to `from` when `to` is inside it (`''` when they are
 * the same directory), and a `..`-prefixed path when it genuinely is not.
 */
const getContainedRelativePath = (from: string, to: string) => {
  // Resolve symlinks first, for the same reason the case comparison below
  // exists: `/data/media` and a `/data/media-link` pointing at it are one
  // directory, and comparing the spellings would call them unrelated. Falls
  // back to the given path when it does not exist yet — realpath throws ENOENT,
  // and a missing directory simply has nothing in it to skip.
  const realFrom = toRealPath(from)
  const realTo = toRealPath(to)
  const direct = path.relative(realFrom, realTo)
  if (!direct.startsWith('..') && !path.isAbsolute(direct)) return direct
  if (!isCaseInsensitiveFilesystem()) return direct

  // Compare segment by segment and rebuild from the real-cased segments. Any
  // approach that measures one string against the other assumes lowercasing
  // preserves length, and it does not — 'İ' lowercases to two code units — so
  // an index taken from either side can cut in the wrong place. Splitting side-
  // steps the question entirely.
  const fromSegments = realFrom.split(path.sep)
  const toSegments = realTo.split(path.sep)
  if (toSegments.length < fromSegments.length) return direct
  const isContained = fromSegments.every(
    (segment, index) =>
      segment.toLowerCase() === toSegments[index].toLowerCase()
  )
  if (!isContained) return direct
  return toSegments.slice(fromSegments.length).join('/')
}

/**
 * Storage-root-relative prefix that fitness files occupy inside MEDIA storage.
 *
 * With no fitness storage configured, fitness files fall back to the media
 * backend under a `fitness/` directory (local) or key prefix (S3) — see
 * `getEffectiveFitnessStorageConfig`. Those objects are referenced by
 * `fitness_files.path`, which is relative to the FITNESS root, not this
 * script's, so they can never match a media reference and every one of them
 * would be reported as orphaned: running `--yes` would delete every stored
 * .fit/.gpx/.tcx and every Strava archive, permanently breaking route data,
 * retries and Regenerate maps.
 *
 * This script only manages media, so it skips that namespace outright rather
 * than trying to translate a second path convention. `scripts/backup/
 * productionArchive.ts` excludes the same shared prefix from its media plan.
 *
 * The bucket comparison is deliberately name-only: if two providers happen to
 * share a bucket name, over-skipping leaves a few files unreclaimed, which is
 * the right way for a deletion tool to be wrong.
 */
const getSharedFitnessPrefix = (mediaStorage: MediaStorageConfig) => {
  const fitnessStorage = getEffectiveFitnessStorageConfig()
  if (!fitnessStorage) return null

  if (
    mediaStorage.type === MediaStorageType.LocalFile &&
    fitnessStorage.type === FitnessStorageType.LocalFile
  ) {
    const mediaRoot = path.resolve(process.cwd(), mediaStorage.path)
    const fitnessRoot = path.resolve(process.cwd(), fitnessStorage.path)
    const relative = getContainedRelativePath(mediaRoot, fitnessRoot)
    if (relative === '') {
      // Same directory for both: nothing in the listing distinguishes a fitness
      // file from a media file, so any orphan set would include every stored
      // activity. Refuse rather than guess.
      return 'INDISTINGUISHABLE'
    }
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null
    }
    return `${relative.replace(/\\/g, '/').replace(/\/+$/, '')}/`
  }

  const mediaIsS3 =
    mediaStorage.type === MediaStorageType.S3Storage ||
    mediaStorage.type === MediaStorageType.ObjectStorage
  const fitnessIsS3 =
    fitnessStorage.type === FitnessStorageType.S3Storage ||
    fitnessStorage.type === FitnessStorageType.ObjectStorage
  if (!mediaIsS3 || !fitnessIsS3) return null
  if (mediaStorage.bucket !== fitnessStorage.bucket) return null

  const prefix = fitnessStorage.prefix || 'fitness/'
  return prefix.endsWith('/') ? prefix : `${prefix}/`
}

async function listLocalFiles(basePath: string): Promise<string[]> {
  const files: string[] = []

  async function traverse(currentPath: string, relativePath = '') {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)
        const relPath = relativePath
          ? path.join(relativePath, entry.name)
          : entry.name

        if (entry.isDirectory()) {
          await traverse(fullPath, relPath)
        } else if (entry.isFile()) {
          files.push(relPath)
        }
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') {
        console.error(`Error reading directory ${currentPath}:`, err.message)
      }
    }
  }

  await traverse(basePath)
  return files
}

async function listS3Files(
  bucket: string,
  region: string,
  endpoint?: string
): Promise<string[]> {
  const client = createStorageS3Client({ region, endpoint })
  const files: string[] = []

  try {
    let continuationToken: string | undefined

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken
      })

      const response = await client.send(command)

      if (response.Contents) {
        for (const object of response.Contents) {
          if (object.Key) {
            files.push(object.Key)
          }
        }
      }

      continuationToken = response.NextContinuationToken
    } while (continuationToken)

    return files
  } finally {
    client.destroy()
  }
}

async function deleteLocalFile(basePath: string, filePath: string) {
  const fullPath = path.resolve(basePath, filePath)
  // Ensure the resolved path is within the base path (prevent directory traversal)
  if (!fullPath.startsWith(path.resolve(basePath))) {
    throw new Error(`Invalid file path: ${filePath}`)
  }
  await fs.unlink(fullPath)
}

async function deleteS3File(
  client: S3Client,
  bucket: string,
  filePath: string
) {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: filePath
  })
  await client.send(command)
}

async function promptConfirmation(orphanedFiles: string[]): Promise<boolean> {
  console.log('\n⚠️  This will permanently delete the following files:')
  console.log('─'.repeat(60))

  // Show first 10 files
  const displayFiles = orphanedFiles.slice(0, 10)
  for (const file of displayFiles) {
    console.log(`  • ${file}`)
  }

  if (orphanedFiles.length > 10) {
    console.log(`  ... and ${orphanedFiles.length - 10} more files`)
  }

  console.log('─'.repeat(60))
  console.log(`Total: ${orphanedFiles.length} files`)

  // Read user input
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question('\nProceed with deletion? (yes/no): ', (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'yes')
    })
  })
}

function showHelp() {
  console.log('🧹 Media Storage Cleanup Script')
  console.log('═'.repeat(60))
  console.log()
  console.log('Usage: scripts/maintenance/cleanupMediaStorage [OPTIONS]')
  console.log()
  console.log('Options:')
  console.log(
    '  --dry-run    Show what would be deleted without actually deleting'
  )
  console.log('  --yes        Skip confirmation prompt and delete immediately')
  console.log('  --help       Show this help message')
  console.log()
  console.log('Description:')
  console.log(
    '  This script cleans up media files that are not referenced in the database.'
  )
  console.log(
    '  It supports both local file storage and S3-compatible storage.'
  )
  console.log()
  console.log('Examples:')
  console.log('  # Preview what would be deleted')
  console.log('  ./scripts/maintenance/cleanupMediaStorage --dry-run')
  console.log()
  console.log('  # Clean up with confirmation prompt')
  console.log('  ./scripts/maintenance/cleanupMediaStorage')
  console.log()
  console.log('  # Clean up without confirmation')
  console.log('  ./scripts/maintenance/cleanupMediaStorage --yes')
  console.log()
}

async function cleanupMediaStorage() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    showHelp()
    process.exit(0)
  }

  const dryRun = args.includes('--dry-run')
  const skipConfirmation = args.includes('--yes')

  console.log('🧹 Media Storage Cleanup Script')
  console.log('═'.repeat(60))

  if (dryRun) {
    console.log('🔍 Running in DRY-RUN mode (no files will be deleted)\n')
  }

  const config = getConfig()

  if (!config.mediaStorage) {
    console.error('Error: Media storage is not configured')
    console.error(
      'Please set ACTIVITIES_MEDIA_STORAGE_TYPE and related environment variables'
    )
    process.exit(1)
  }

  console.log(`Storage Type: ${config.mediaStorage.type}`)

  const fitnessPrefix = getSharedFitnessPrefix(config.mediaStorage)
  if (fitnessPrefix === 'INDISTINGUISHABLE') {
    console.error(
      '\nError: fitness storage points at the same directory as media storage.'
    )
    console.error(
      'Every stored activity file would be reported as an orphaned media file.'
    )
    console.error(
      'Point ACTIVITIES_FITNESS_STORAGE_PATH at its own directory before running this.'
    )
    process.exit(1)
  }

  // Determine base path for local storage normalization
  const basePath =
    config.mediaStorage.type === MediaStorageType.LocalFile
      ? path.resolve(process.cwd(), config.mediaStorage.path)
      : undefined

  // Step 1: Get all media paths from database
  console.log('\n📊 Step 1: Fetching media references from database...')
  const dbPaths = await getAllMediaPathsFromDatabase(basePath)
  console.log(`   Found ${dbPaths.size} media files in database`)

  // Step 2: List all files in storage
  console.log('\n📂 Step 2: Listing files in storage...')
  let storageFiles: string[] = []

  switch (config.mediaStorage.type) {
    case MediaStorageType.LocalFile: {
      console.log(`   Storage path: ${config.mediaStorage.path}`)
      // basePath is guaranteed to be defined for LocalFile storage type
      if (!basePath) {
        throw new Error('Base path is not defined for local file storage')
      }
      storageFiles = await listLocalFiles(basePath)
      break
    }
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      console.log(`   S3 Bucket: ${config.mediaStorage.bucket}`)
      console.log(`   Region: ${config.mediaStorage.region}`)
      storageFiles = await listS3Files(
        config.mediaStorage.bucket,
        config.mediaStorage.region,
        config.mediaStorage.endpoint
      )
      break
    }
    default:
      console.error('Error: Unsupported storage type')
      process.exit(1)
  }

  console.log(`   Found ${storageFiles.length} files in storage`)

  // Fitness files may live inside media storage but are not this script's to
  // manage, and their references are relative to a different root.
  if (fitnessPrefix) {
    const before = storageFiles.length
    // Match the prefix the same way the filesystem matches names. The prefix
    // carries the CONFIGURED spelling while the listing carries the on-disk
    // one, so `ACTIVITIES_FITNESS_STORAGE_PATH=…/Fitness` against a directory
    // created as `fitness` would skip nothing on a case-insensitive
    // filesystem — and every stored activity file would be offered for
    // deletion, which is the whole reason this skip exists.
    const matchesFitnessPrefix = isCaseInsensitiveFilesystem()
      ? (file: string) =>
          file.toLowerCase().startsWith(fitnessPrefix.toLowerCase())
      : (file: string) => file.startsWith(fitnessPrefix)
    storageFiles = storageFiles.filter((file) => !matchesFitnessPrefix(file))
    const skipped = before - storageFiles.length
    console.log(
      `   Skipped ${skipped} file(s) under the shared fitness prefix '${fitnessPrefix}' (managed as fitness storage, not media)`
    )
  }

  // Step 3: Find orphaned files
  console.log('\n🔍 Step 3: Identifying orphaned files...')
  const orphanedFiles = storageFiles.filter((file) => !dbPaths.has(file))
  console.log(`   Found ${orphanedFiles.length} orphaned files`)

  if (orphanedFiles.length === 0) {
    console.log('\n✅ No orphaned files found. Storage is clean!')
    process.exit(0)
  }

  // Step 4: Display results
  console.log('\n📋 Orphaned files (not in database):')
  console.log('─'.repeat(60))

  if (dryRun) {
    // In dry-run mode, show all files
    const displayLimit = 20
    const displayFiles = orphanedFiles.slice(0, displayLimit)

    for (const file of displayFiles) {
      console.log(`  • ${file}`)
    }

    if (orphanedFiles.length > displayLimit) {
      console.log(`  ... and ${orphanedFiles.length - displayLimit} more files`)
    }

    console.log('─'.repeat(60))
    console.log(`\nTotal: ${orphanedFiles.length} orphaned files`)
    console.log('\n✅ Dry-run complete. Run without --dry-run to delete.')
    process.exit(0)
  }

  // Step 5: Confirm deletion
  let shouldDelete = skipConfirmation
  if (!skipConfirmation) {
    shouldDelete = await promptConfirmation(orphanedFiles)
  }

  if (!shouldDelete) {
    console.log('\n❌ Deletion cancelled.')
    process.exit(0)
  }

  // Step 6: Delete orphaned files
  console.log('\n🗑️  Step 6: Deleting orphaned files...')

  let deletedCount = 0
  let errorCount = 0
  const deleteS3Client =
    config.mediaStorage.type === MediaStorageType.S3Storage ||
    config.mediaStorage.type === MediaStorageType.ObjectStorage
      ? createStorageS3Client({
          region: config.mediaStorage.region,
          endpoint: config.mediaStorage.endpoint
        })
      : undefined

  try {
    for (const file of orphanedFiles) {
      try {
        switch (config.mediaStorage.type) {
          case MediaStorageType.LocalFile:
            // basePath is guaranteed to be defined for LocalFile storage type
            if (!basePath) {
              throw new Error('Base path is not defined for local file storage')
            }
            await deleteLocalFile(basePath, file)
            break
          case MediaStorageType.S3Storage:
          case MediaStorageType.ObjectStorage:
            if (!deleteS3Client) {
              throw new Error('S3 client is not defined for S3 storage')
            }
            await deleteS3File(deleteS3Client, config.mediaStorage.bucket, file)
            break
        }
        deletedCount++
        if (deletedCount % 10 === 0) {
          console.log(
            `   Deleted ${deletedCount}/${orphanedFiles.length} files...`
          )
        }
      } catch (error) {
        const err = error as Error
        console.error(`   Failed to delete ${file}: ${err.message}`)
        errorCount++
      }
    }
  } finally {
    deleteS3Client?.destroy()
  }

  console.log('\n✅ Cleanup complete!')
  console.log(`   Deleted: ${deletedCount} files`)
  if (errorCount > 0) {
    console.log(`   Errors: ${errorCount} files`)
  }

  process.exit(errorCount > 0 ? 1 : 0)
}

cleanupMediaStorage().catch((error) => {
  console.error('\n❌ Error during cleanup:', error)
  process.exit(1)
})
