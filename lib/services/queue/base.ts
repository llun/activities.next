import { JOBS } from '@/lib/jobs'
import { getStorage } from '@/lib/storage'
import { logger } from '@/lib/utils/logger'

import { JobMessage } from './type'

export const defaultJobHandle =
  (queueName: string) => async (message: JobMessage) => {
    logger.debug({ message }, `${queueName} handle job`)
    const storage = await getStorage()
    if (!storage) {
      logger.error('Storage is not available')
      return
    }

    const job = JOBS[message.name]
    if (!job) {
      logger.error({ message }, 'Unknown job name')
      return
    }

    await job(storage, message)
  }
