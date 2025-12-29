import { z } from 'zod'

export const PollAnswer = z.object({
  answerId: z.number(),
  choice: z.number(), // References poll_choices.choiceId
  actorId: z.string(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type PollAnswer = z.infer<typeof PollAnswer>
