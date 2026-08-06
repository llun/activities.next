#!/usr/bin/env -S node scripts/run.cjs
/**
 * Exports everything belonging to one local actor (statuses at every
 * visibility, media and fitness files, profile, likes/bookmarks, follows)
 * into a Mastodon-compatible ActivityPub archive.
 *
 * Usage:
 *   NODE_ENV=production scripts/backup/exportActorArchive.ts --username alice
 *
 * See ./actorArchive.ts EXPORT_ACTOR_USAGE for the full flag reference.
 */
import { exportActorArchive } from './actorArchive'

if (require.main === module) {
  exportActorArchive()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error('Actor archive export failed:', error)
      process.exit(1)
    })
}
