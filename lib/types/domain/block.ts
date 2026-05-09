import { z } from 'zod'

export const Block = z.object({
  id: z.string(),
  actorId: z.string(),
  actorHost: z.string(),

  targetActorId: z.string(),
  targetActorHost: z.string(),

  uri: z.string(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type Block = z.infer<typeof Block>
