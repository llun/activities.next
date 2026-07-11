#!/usr/bin/env -S node scripts/run.cjs
/**
 * Deletes legacy PNG heatmap media captured during the route-heatmap migration.
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/cleanupLegacyFitnessHeatmaps.ts
 */
import { loadEnvConfig } from '@next/env'

import { getDatabase } from '@/lib/database'
import { deleteMediaFile } from '@/lib/services/medias'

import { printDatabaseBanner } from './describeConnection'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

async function cleanupLegacyFitnessHeatmaps() {
  printDatabaseBanner()

  const database = getDatabase()
  if (!database) {
    console.error('Database is not available')
    return 1
  }

  try {
    const paths = await database.getLegacyFitnessHeatmapMediaCleanupPaths()
    if (paths.length === 0) {
      console.log('No legacy fitness heatmap media paths to clean up.')
      return 0
    }

    let deleted = 0
    let failed = 0

    for (const { actorId, imagePath } of paths) {
      try {
        const storageDeleted = await deleteMediaFile(database, imagePath)
        if (!storageDeleted) {
          throw new Error('Storage backend did not confirm deletion')
        }

        const databaseDeleted = await database.deleteMediaByPath({
          actorId,
          path: imagePath
        })
        // A false `databaseDeleted` means the `medias` row was ALREADY gone
        // (lib/database/sql/media.ts returns false when the row isn't found).
        // On a re-run that is an idempotent success, NOT a failure, so we fall
        // through and mark the queue row done — letting it drain instead of
        // being permanently stranded as 'failed'. Genuine problems still
        // surface: the storage delete above keeps a false as an error, and any
        // thrown exception is handled as a failure below.

        await database.markLegacyFitnessHeatmapMediaCleanupPath({
          actorId,
          imagePath
        })
        deleted += 1
        console.log(
          databaseDeleted
            ? `Deleted ${imagePath}`
            : `Already deleted ${imagePath} (media row was gone)`
        )
      } catch (error) {
        const nodeError = error as Error
        failed += 1
        await database.markLegacyFitnessHeatmapMediaCleanupPath({
          actorId,
          imagePath,
          error: nodeError.message
        })
        console.error(`Failed ${imagePath}: ${nodeError.message}`)
      }
    }

    console.log(
      `Legacy fitness heatmap cleanup complete: ${deleted} deleted, ${failed} failed.`
    )
    return failed > 0 ? 1 : 0
  } finally {
    await database.destroy()
  }
}

cleanupLegacyFitnessHeatmaps()
  .then((code) => {
    process.exit(code)
  })
  .catch((error) => {
    const nodeError = error as Error
    console.error(nodeError.message)
    process.exit(1)
  })
