import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { IMPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import {
  getAccountImportContinuationJobId,
  runAccountImport
} from '@/lib/services/accountImport/runner'
import { getQueue } from '@/lib/services/queue'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

const JobData = z.object({
  importId: z.string().min(1),
  actorId: z.string().min(1)
})

export const importAccountArchiveJob = createJobHandle(
  IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
  async (database, message) => {
    const { importId, actorId } = JobData.parse(message.data)
    const queue = getQueue()
    const result = await runAccountImport(database, importId, {
      actorId,
      runsInline: queue.runsInline
    })
    if (result.type !== 'continued') return

    const cursor = `${result.phase}:${result.cursor ?? ''}`
    try {
      await queue.publish({
        id: getAccountImportContinuationJobId(importId, cursor, result.pass),
        name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
        data: { importId, actorId }
      })
    } catch (error) {
      // The stale-run sweep requeues this saved phase and cursor.
      logger.error({
        message: 'Failed to queue an account archive import continuation',
        importId,
        err: toLoggableError(error)
      })
      throw error
    }
  }
)
