import { z } from 'zod'

const MAX_POLL_CHOICES_PER_VOTE = 20

export const VotePollRequest = z.object({
  statusId: z.string().min(1),
  choices: z
    .number()
    .int()
    .nonnegative()
    .array()
    .min(1)
    .max(MAX_POLL_CHOICES_PER_VOTE)
})
