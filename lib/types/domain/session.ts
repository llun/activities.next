import { z } from 'zod'

export const Session = z.object({
  token: z.string(),
  accountId: z.string(),
  actorId: z.string().nullable(),
  expireAt: z.number(),

  createdAt: z.number(),
  updatedAt: z.number()
})
export type Session = z.infer<typeof Session>
