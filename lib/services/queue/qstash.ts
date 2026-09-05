import { context, propagation } from '@opentelemetry/api'
import type { Client } from '@upstash/qstash'
import { z } from 'zod'

import { dynamicImport } from '@/lib/utils/dynamicImport'
import { withSpan } from '@/lib/utils/trace'

import { defaultJobHandle } from './base'
import { JobMessage, Queue } from './type'

export const QStashConfig = z.object({
  type: z.literal('qstash'),
  url: z.string().url(),
  token: z.string(),
  currentSigningKey: z.string(),
  nextSigningKey: z.string(),
  maxRetries: z.number().int().nonnegative().optional()
})
export type QStashConfig = z.infer<typeof QStashConfig>

const MAX_JOB_TIMEOUT_SECONDS = 30
const DEFAULT_MAX_JOB_RETRIES = 3

export class QStashQueue implements Queue {
  // QStash only enqueues on `publish`; the job runs out of band, not inline.
  readonly runsInline = false

  private _client?: Client
  private _url: string
  private _maxRetries: number
  private _token: string

  constructor(config: QStashConfig) {
    this._url = config.url
    this._maxRetries = config.maxRetries ?? DEFAULT_MAX_JOB_RETRIES
    this._token = config.token
  }

  private async getClient(): Promise<Client> {
    if (!this._client) {
      const { Client: QStashClient } = await dynamicImport<{
        Client: typeof Client
      }>('@upstash/qstash')
      this._client = new QStashClient({
        token: this._token
      })
    }
    return this._client
  }

  async publish(message: JobMessage): Promise<void> {
    return withSpan('queue', 'publish', { jobName: message.name }, async () => {
      const traceHeaders: Record<string, string> = {}
      propagation.inject(context.active(), traceHeaders)

      const client = await this.getClient()
      await client.publishJSON({
        url: this._url,
        body: message,
        timeout: MAX_JOB_TIMEOUT_SECONDS,
        retries: this._maxRetries,
        deduplicationId: Buffer.from(message.id).toString('base64url'),
        ...(Object.keys(traceHeaders).length > 0
          ? { headers: traceHeaders }
          : {}),
        ...(message.delaySeconds && message.delaySeconds > 0
          ? { delay: message.delaySeconds }
          : {})
      })
    })
  }

  handle(message: JobMessage) {
    return defaultJobHandle('qstash')(message)
  }
}
