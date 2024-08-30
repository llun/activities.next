import { CREATE_NOTE_JOB_NAME, createNote } from '@/lib/actions/createNote'
import { getStorage } from '@/lib/storage'
import { logger } from '@/lib/utils/logger'

import { JobMessage, Queue } from './type'

export class NoQueue implements Queue {
  async publish(message: JobMessage): Promise<void> {
    await this.handle(message)
  }

  async handle(message: JobMessage): Promise<void> {
    logger.debug({ message }, 'NoQueue Handling message')
    const storage = await getStorage()
    if (!storage) {
      throw new Error('Storage is not available')
    }

    switch (message.name) {
      case CREATE_NOTE_JOB_NAME: {
        await createNote({ storage, note: message.data })
        return
      }
      default: {
        logger.error(`Unknown job name: ${message.name}`)
      }
    }
  }
}
