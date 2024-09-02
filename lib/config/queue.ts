import { z } from 'zod'

import { QStashConfig } from '../services/queue/qstash'
import { matcher } from './utils'

export const QueueConfig = QStashConfig
export type QueueConfig = z.infer<typeof QueueConfig>

export const getQueueConfig = (): { queue: QueueConfig } | null => {
  const hasEnvironmentQueue = matcher('ACTIVITIES_QUEUE_')
  if (!hasEnvironmentQueue) return null

  switch (process.env.ACTIVITIES_QUEUE_TYPE) {
    case 'qstash':
      return {
        queue: {
          type: 'qstash',
          url: process.env.ACTIVITIES_QUEUE_URL as string,
          token: process.env.ACTIVITIES_QUEUE_TOKEN as string,
          currentSigningKey: process.env
            .ACTIVITIES_QUEUE_CURRENT_SIGNING_KEY as string,
          nextSigningKey: process.env
            .ACTIVITIES_QUEUE_NEXT_SIGNING_KEY as string
        }
      }
    default:
      return null
  }
}
