import { z } from 'zod'

export const VotePollRequest = z.object({
  statusId: z.string().min(1),
  choices: z.number().int().nonnegative().array().min(1)
})
