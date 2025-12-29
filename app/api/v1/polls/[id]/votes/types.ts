import { z } from 'zod'

export const VotePollRequest = z.object({
  choices: z.array(z.number()).min(1).max(1) // Currently only single-choice supported
})

export type VotePollRequest = z.infer<typeof VotePollRequest>
