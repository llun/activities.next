import { Client } from '@upstash/qstash'
import { z } from 'zod'

import { CREATE_NOTE_JOB_NAME, createNote } from '@/lib/actions/createNote'
import { getStorage } from '@/lib/storage'
import { logger } from '@/lib/utils/logger'

import { JobMessage, Queue } from './type'

export const QStashConfig = z.object({
  type: z.literal('qstash'),
  url: z.string().url(),
  token: z.string(),
  currentSigningKey: z.string(),
  nextSigningKey: z.string(),
  queueName: z.string()
})
export type QStashConfig = z.infer<typeof QStashConfig>

export class QStashQueue implements Queue {
  private _client: Client
  private _url: string

  constructor(config: QStashConfig) {
    this._url = config.url
    this._client = new Client({
      token: config.token
    })
  }

  async publish(message: JobMessage): Promise<void> {
    await this._client.publishJSON({
      url: this._url,
      message
    })
  }

  async handle(message: JobMessage): Promise<void> {
    logger.debug('Handling message', message)
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
