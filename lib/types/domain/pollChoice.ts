import { z } from 'zod'

export const PollChoice = z.object({
  statusId: z.string(),
  title: z.string(),
  totalVotes: z.number(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type PollChoice = z.infer<typeof PollChoice>
