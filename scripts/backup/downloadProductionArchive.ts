#!/usr/bin/env -S node scripts/run.cjs
/**
 * Downloads a read-only production snapshot into a local archive.
 *
 * Usage:
 *   NODE_ENV=production scripts/backup/downloadProductionArchive.ts
 *
 * The default archive includes database rows plus database-referenced media and
 * fitness files. Use --storage-scope all to include every object in the
 * configured storage locations.
 */
import { downloadProductionArchive } from './productionArchive'

if (require.main === module) {
  downloadProductionArchive()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Archive download failed:', error)
      process.exit(1)
    })
}
