#!/usr/bin/env -S node scripts/run.cjs
/**
 * Restores a production archive into the configured local database and local
 * filesystem storage.
 *
 * Usage:
 *   scripts/restoreProductionArchive.ts \
 *     --archive backups/production-archives/activitynext-production-...tar.gz \
 *     --yes
 *
 * This script refuses NODE_ENV=production and remote database hosts unless
 * --allow-non-local-database is passed.
 */
import { restoreProductionArchive } from './productionArchive'

if (require.main === module) {
  restoreProductionArchive()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Archive restore failed:', error)
      process.exit(1)
    })
}
