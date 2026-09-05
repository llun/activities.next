import { z } from 'zod'

import { QStashConfig } from '@/lib/services/queue/qstash'

import { matcher } from './utils'

export { QStashConfig } from '@/lib/services/queue/qstash'

export const CloudTasksConfig = z.object({
  type: z.literal('cloudtasks'),
  url: z.string().optional(),
  queue: z.string().optional(),
  location: z.string().optional(),
  project: z.string().optional(),
  serviceAccount: z.string().optional(),
  audience: z.string().optional(),
  secret: z.string().optional(),
  maxRetries: z.number().int().positive().optional()
})
export type CloudTasksConfig = z.infer<typeof CloudTasksConfig>

export const QueueConfig = z.discriminatedUnion('type', [
  QStashConfig,
  CloudTasksConfig
])
export type QueueConfig = z.infer<typeof QueueConfig>

export const getQueueConfig = (): { queue: QueueConfig } | null => {
  const hasEnvironmentQueue = matcher('ACTIVITIES_QUEUE_')
  if (!hasEnvironmentQueue) return null

  switch (process.env.ACTIVITIES_QUEUE_TYPE) {
    case 'qstash': {
      const maxRetriesStr = process.env.ACTIVITIES_QUEUE_QSTASH_MAX_RETRIES
      return {
        queue: {
          type: 'qstash',
          url: process.env.ACTIVITIES_QUEUE_URL as string,
          token: process.env.ACTIVITIES_QUEUE_TOKEN as string,
          currentSigningKey: process.env
            .ACTIVITIES_QUEUE_CURRENT_SIGNING_KEY as string,
          nextSigningKey: process.env
            .ACTIVITIES_QUEUE_NEXT_SIGNING_KEY as string,
          maxRetries: maxRetriesStr ? parseInt(maxRetriesStr, 10) : 3
        }
      }
    }
    case 'cloudtasks': {
      const maxRetriesStr = process.env.ACTIVITIES_QUEUE_CLOUDTASKS_MAX_RETRIES
      return {
        queue: {
          type: 'cloudtasks',
          url: process.env.ACTIVITIES_QUEUE_URL,
          queue: process.env.ACTIVITIES_QUEUE_NAME,
          location:
            process.env.ACTIVITIES_QUEUE_CLOUDTASKS_LOCATION || 'europe-west1',
          project:
            process.env.ACTIVITIES_QUEUE_CLOUDTASKS_PROJECT_ID ||
            process.env.FIREBASE_PROJECT_ID,
          serviceAccount:
            process.env.ACTIVITIES_QUEUE_CLOUDTASKS_SERVICE_ACCOUNT,
          audience: process.env.ACTIVITIES_QUEUE_CLOUDTASKS_AUDIENCE,
          secret: process.env.ACTIVITIES_QUEUE_CLOUDTASKS_SECRET,
          maxRetries: maxRetriesStr ? parseInt(maxRetriesStr, 10) : 5
        }
      }
    }
    default:
      return null
  }
}
