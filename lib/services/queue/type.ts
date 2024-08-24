import { z } from 'zod'

export const QueueMessage = z.object({
  job: z.string()
})

export interface Queue {
  publish(): Promise<void>
}
