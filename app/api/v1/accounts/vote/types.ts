import { z } from 'zod'

export const VotePollRequest = z.object({
  statusId: z.string(),
  choices: z.number().array().min(1)
})
