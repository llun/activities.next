import { z } from 'zod'

import { createJobHandle } from './createJobHandle'
import { CLEANUP_TEMPORARY_STATUS_JOB_NAME } from './names'

export const cleanupTemporaryStatusJob = createJobHandle(
  CLEANUP_TEMPORARY_STATUS_JOB_NAME,
  async (database, message) => {
    const { statusId } = z.object({ statusId: z.string() }).parse(message.data)

    await database.deleteTemporaryStatus({ statusId })
  }
)
