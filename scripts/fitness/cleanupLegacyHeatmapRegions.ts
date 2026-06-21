#!/usr/bin/env -S node scripts/run.cjs
/**
 * Soft-deletes route-heatmap cache rows left in the legacy named-region format
 * (e.g. `region = "netherlands,singapore"`) after the move to the world/rectangle
 * region model. Those rows are unreachable by the new code (which keys on `''`
 * for the whole world or `rect:` bounding-box tokens) and would otherwise linger
 * in the job list mislabelled as "Whole world".
 *
 * Whole-world caches (`region = ''`) and new `rect:` caches are left untouched.
 * Deletion is a soft-delete (sets `deletedAt`), matching the rest of the app.
 *
 * Dry-run by default — pass `--apply` to actually delete.
 *
 * Usage:
 *   NODE_ENV=production scripts/fitness/cleanupLegacyHeatmapRegions.ts          # report only
 *   NODE_ENV=production scripts/fitness/cleanupLegacyHeatmapRegions.ts --apply  # soft-delete
 */
import { loadEnvConfig } from '@next/env'

import { getDatabase } from '@/lib/database'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

async function cleanupLegacyHeatmapRegions() {
  const apply = process.argv.includes('--apply')
  const database = getDatabase()
  if (!database) {
    console.error('Database is not available')
    return 1
  }

  try {
    const count = await database.countLegacyRegionRouteHeatmaps()
    if (count === 0) {
      console.log('No legacy named-region route heatmaps to clean up.')
      return 0
    }

    if (!apply) {
      console.log(
        `${count} legacy named-region route heatmap(s) would be soft-deleted. ` +
          'Re-run with --apply to delete them.'
      )
      return 0
    }

    const deleted = await database.softDeleteLegacyRegionRouteHeatmaps()
    console.log(`Soft-deleted ${deleted} legacy named-region route heatmap(s).`)
    return 0
  } finally {
    await database.destroy()
  }
}

cleanupLegacyHeatmapRegions()
  .then((code) => {
    process.exit(code)
  })
  .catch((error) => {
    const nodeError = error as Error
    console.error(nodeError.message)
    process.exit(1)
  })
