import { z } from 'zod'

export const FollowStatus = z.enum([
  'Requested',
  'Accepted',
  'Undo',
  'Rejected'
])
export type FollowStatus = z.infer<typeof FollowStatus>

export const Follow = z.object({
  id: z.string(),
  actorId: z.string(),
  actorHost: z.string(),

  targetActorId: z.string(),
  targetActorHost: z.string(),

  status: FollowStatus,

  inbox: z.string(),
  sharedInbox: z.string().optional(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type Follow = z.infer<typeof Follow>
