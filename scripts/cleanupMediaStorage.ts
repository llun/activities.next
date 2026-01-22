/**
 * Script to clean up media files that are not referenced in the database
 * Usage: scripts/cleanupMediaStorage [--dry-run] [--yes]
 *
 * Options:
 *   --dry-run   Show what would be deleted without actually deleting
 *   --yes       Skip confirmation prompt and delete immediately
 */
import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import fs from 'fs/promises'
import knex from 'knex'
import path from 'path'

import { getConfig } from '../lib/config'
import { MediaStorageType } from '../lib/config/mediaStorage'

async function getAllMediaPathsFromDatabase(
  basePath?: string
): Promise<Set<string>> {
  const config = getConfig()
  const database = knex(config.database)

  try {
    // Get all media paths from the medias table
    const medias = await database('medias').select('original', 'thumbnail')

    const paths = new Set<string>()
    for (const media of medias) {
      if (media.original) {
        // For local file storage, normalize to relative paths
        const originalPath = basePath
          ? path.relative(basePath, media.original)
          : media.original
        paths.add(originalPath)
      }
      if (media.thumbnail) {
        // For local file storage, normalize to relative paths
        const thumbnailPath = basePath
          ? path.relative(basePath, media.thumbnail)
          : media.thumbnail
        paths.add(thumbnailPath)
      }
    }

    return paths
  } finally {
    await database.destroy()
  }
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

async function listS3Files(bucket: string, region: string): Promise<string[]> {
  const client = new S3Client({ region })
  const files: string[] = []

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
}

async function deleteLocalFile(basePath: string, filePath: string) {
  const fullPath = path.resolve(basePath, filePath)
  // Ensure the resolved path is within the base path (prevent directory traversal)
  if (!fullPath.startsWith(path.resolve(basePath))) {
    throw new Error(`Invalid file path: ${filePath}`)
  }
  await fs.unlink(fullPath)
}

async function deleteS3File(bucket: string, region: string, filePath: string) {
  const client = new S3Client({ region })
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
  console.log('Usage: scripts/cleanupMediaStorage [OPTIONS]')
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
  console.log('  ./scripts/cleanupMediaStorage --dry-run')
  console.log()
  console.log('  # Clean up with confirmation prompt')
  console.log('  ./scripts/cleanupMediaStorage')
  console.log()
  console.log('  # Clean up without confirmation')
  console.log('  ./scripts/cleanupMediaStorage --yes')
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
        config.mediaStorage.region
      )
      break
    }
    default:
      console.error('Error: Unsupported storage type')
      process.exit(1)
  }

  console.log(`   Found ${storageFiles.length} files in storage`)

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
          await deleteS3File(
            config.mediaStorage.bucket,
            config.mediaStorage.region,
            file
          )
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
