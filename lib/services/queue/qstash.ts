import { Client } from '@upstash/qstash'

import { CREATE_NOTE_JOB_NAME } from '@/lib/actions/createNote'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/utils/logger'

import { JobMessage, Queue } from './type'

export class QStashQueue implements Queue {
  private _client: Client
  private _url: string

  constructor() {
    const config = getConfig()
    if (config.queue?.type !== 'qstash') {
      throw new Error('Invalid queue type')
    }

    this._url = config.queue.url
    this._client = new Client({
      token: config.queue.token
    })
  }

  async publish(message: JobMessage): Promise<void> {
    await this._client.publishJSON({
      url: this._url,
      message
    })
  }

  async handle(message: JobMessage): Promise<void> {
    switch (message.name) {
      case CREATE_NOTE_JOB_NAME: {
        return
      }
      default: {
        logger.error(`Unknown job name: ${message.name}`)
      }
    }
  }
}
