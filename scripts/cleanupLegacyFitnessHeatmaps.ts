#!/usr/bin/env -S node -r @swc-node/register
/**
 * Deletes legacy PNG heatmap media captured during the route-heatmap migration.
 *
 * Usage:
 *   NODE_ENV=production scripts/cleanupLegacyFitnessHeatmaps.ts
 */
import { loadEnvConfig } from '@next/env'

import { getDatabase } from '@/lib/database'
import { deleteMediaFile } from '@/lib/services/medias'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

async function cleanupLegacyFitnessHeatmaps() {
  const database = getDatabase()
  if (!database) {
    console.error('Database is not available')
    return 1
  }

  const paths = await database.getLegacyFitnessHeatmapMediaCleanupPaths()
  if (paths.length === 0) {
    console.log('No legacy fitness heatmap media paths to clean up.')
    return 0
  }

  let deleted = 0
  let failed = 0

  for (const imagePath of paths) {
    try {
      const storageDeleted = await deleteMediaFile(database, imagePath)
      if (!storageDeleted) {
        throw new Error('Storage backend did not confirm deletion')
      }

      await database.deleteMediaByPath({ path: imagePath })
      await database.markLegacyFitnessHeatmapMediaCleanupPath({ imagePath })
      deleted += 1
      console.log(`Deleted ${imagePath}`)
    } catch (error) {
      const nodeError = error as Error
      failed += 1
      await database.markLegacyFitnessHeatmapMediaCleanupPath({
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
}

cleanupLegacyFitnessHeatmaps()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    const nodeError = error as Error
    console.error(nodeError.message)
    process.exitCode = 1
  })
