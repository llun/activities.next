import { Client } from '@upstash/qstash'
import { z } from 'zod'

import { defaultJobHandle } from './base'
import { JobMessage, Queue } from './type'

export const QStashConfig = z.object({
  type: z.literal('qstash'),
  url: z.string().url(),
  token: z.string(),
  currentSigningKey: z.string(),
  nextSigningKey: z.string()
})
export type QStashConfig = z.infer<typeof QStashConfig>

const MAX_JOB_TIMEOUT_SECONDS = 30
const MAX_JOB_RETRIES = 0

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
      body: message,
      timeout: MAX_JOB_TIMEOUT_SECONDS,
      retries: MAX_JOB_RETRIES,
      deduplicationId: message.id
    })
  }

  handle(message: JobMessage) {
    return defaultJobHandle('qstash')(message)
  }
}
