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

  // Local follow preferences (Mastodon POST /accounts/:id/follow params).
  // reblogs: show this account's boosts in the home timeline.
  // notify: receive a notification on this account's new posts.
  // languages: only show posts in these languages (null = no filter).
  reblogs: z.boolean(),
  notify: z.boolean(),
  languages: z.string().array().nullable(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type Follow = z.infer<typeof Follow>
