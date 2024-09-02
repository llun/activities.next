import { JOBS } from '@/lib/jobs'
import { getStorage } from '@/lib/storage'
import { logger } from '@/lib/utils/logger'

import { JobMessage, Queue } from './type'

export class BaseQueue implements Queue {
  async publish(message: JobMessage): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async handle(message: JobMessage): Promise<void> {
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
}
