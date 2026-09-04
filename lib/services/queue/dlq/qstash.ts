import { Client } from '@upstash/qstash'

import { QStashConfig } from '@/lib/services/queue/qstash'
import { JobMessage } from '@/lib/services/queue/type'
import { logger } from '@/lib/utils/logger'

import {
  DLQActionResult,
  DLQJobItem,
  DLQProvider,
  GetDLQJobsParams,
  GetDLQJobsResult
} from './types'

export class QStashDLQProvider implements DLQProvider {
  readonly type = 'qstash' as const
  private _client: Client

  constructor(config: QStashConfig) {
    this._client = new Client({ token: config.token })
  }

  async getJobs(params?: GetDLQJobsParams): Promise<GetDLQJobsResult> {
    const limit = params?.limit ?? 20
    const offset = params?.offset ?? 0

    try {
      const res = await this._client.dlq.listMessages({ count: 100 })
      const messages = res.messages ?? []

      const isFailedOrAll = !params?.status || params.status === 'failed'

      const allFormatted: DLQJobItem[] = messages.map((msg) => {
        let payload: JobMessage
        try {
          payload = JSON.parse(msg.body ?? '{}')
        } catch {
          payload = {
            id: msg.messageId,
            name: 'unknown',
            data: { rawBody: msg.body }
          }
        }

        let errorMessage = 'Delivery failed'
        let errorStack: string | null = null

        if (msg.responseBody) {
          try {
            const parsed = JSON.parse(msg.responseBody)
            errorMessage = parsed.error || parsed.message || msg.responseBody
            errorStack = parsed.stack ?? null
          } catch {
            errorMessage = msg.responseBody
          }
        } else if (msg.responseStatus) {
          errorMessage = `HTTP ${msg.responseStatus}`
        }

        return {
          id: msg.dlqId,
          jobName: payload.name || 'unknown',
          payload,
          errorMessage,
          errorStack,
          attempts: (msg.maxRetries ?? 0) + 1,
          status: 'failed',
          createdAt: msg.createdAt,
          updatedAt: msg.createdAt
        }
      })

      const filteredJobs = isFailedOrAll ? allFormatted : []
      const pagedJobs = filteredJobs.slice(offset, offset + limit)

      return {
        jobs: pagedJobs,
        total: filteredJobs.length,
        counts: {
          all: allFormatted.length,
          failed: allFormatted.length,
          retried: 0,
          discarded: 0
        }
      }
    } catch (error) {
      logger.error({
        err: error,
        message: 'Failed to list messages from QStash DLQ'
      })
      return {
        jobs: [],
        total: 0,
        counts: { all: 0, failed: 0, retried: 0, discarded: 0 }
      }
    }
  }

  async retryJob(id: string): Promise<DLQActionResult> {
    try {
      await this._client.dlq.retry(id)
      return { success: true }
    } catch (error) {
      logger.error({
        err: error,
        id,
        message: 'Failed to retry QStash DLQ job'
      })
      return { success: false, error: 'Failed to retry job in QStash' }
    }
  }

  async discardJob(id: string): Promise<DLQActionResult> {
    try {
      await this._client.dlq.delete(id)
      return { success: true }
    } catch (error) {
      logger.error({
        err: error,
        id,
        message: 'Failed to delete QStash DLQ job'
      })
      return { success: false, error: 'Failed to delete job in QStash' }
    }
  }

  async retryAll(): Promise<DLQActionResult> {
    try {
      const res = await this._client.dlq.retry({ all: true })
      return { success: true, count: res.responses?.length ?? 0 }
    } catch (error) {
      logger.error({
        err: error,
        message: 'Failed to retry all QStash DLQ jobs'
      })
      return { success: false, error: 'Failed to retry all jobs in QStash' }
    }
  }

  async clearDiscarded(): Promise<DLQActionResult> {
    try {
      const res = await this._client.dlq.delete({ all: true })
      return { success: true, count: res.deleted ?? 0 }
    } catch (error) {
      logger.error({
        err: error,
        message: 'Failed to clear all QStash DLQ jobs'
      })
      return { success: false, error: 'Failed to clear jobs in QStash' }
    }
  }
}
