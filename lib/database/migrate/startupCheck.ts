import {
  type MigrationTarget,
  getMigrationStatus
} from '@/lib/database/migrate/status'
import { logger } from '@/lib/utils/logger'

/**
 * Logs an error at startup when the database has migrations pending, or is
 * one `yarn migrate` refuses. It only warns: the app still starts, because
 * the documented deploy runs `yarn migrate` while the previous image keeps
 * serving, and a deploy must not wedge on the order the two happen in. It
 * reads without writing (`getMigrationStatus`) and never throws. It imports
 * status.ts, not lib/database/migrate, so the boot loads neither the runner
 * nor the migrations.
 */
export const warnAboutPendingMigrations = async (target: MigrationTarget) => {
  try {
    const { pending, handover } = await getMigrationStatus(target)
    if (handover.kind === 'refused') {
      logger.error(
        { reason: handover.reason, pending },
        `The database is not ready for this release: ${handover.message}`
      )
      return
    }
    if (pending.length > 0) {
      logger.error(
        { pending },
        'The database has migrations pending; run `yarn migrate` ' +
          '(docs/maintenance.md, "Upgrading past the Knex handover")'
      )
    }
  } catch (error) {
    logger.warn(
      { err: error },
      'Could not check the database for pending migrations'
    )
  }
}
