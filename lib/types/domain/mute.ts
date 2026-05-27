import { z } from 'zod'

export const Mute = z.object({
  id: z.string(),
  actorId: z.string(),
  actorHost: z.string(),

  targetActorId: z.string(),
  targetActorHost: z.string(),

  notifications: z.boolean(),
  endsAt: z.number().nullable(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type Mute = z.infer<typeof Mute>
