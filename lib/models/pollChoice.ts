import { z } from 'zod'

export const PollChoice = z.object({
  choiceId: z.number().optional(),
  statusId: z.string(),
  title: z.string(),
  totalVotes: z.number(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type PollChoice = z.infer<typeof PollChoice>
