import { z } from 'zod'

// Mastodon list "replies_policy": which replies appear in the list timeline.
// https://docs.joinmastodon.org/entities/List/#replies_policy
export const ListRepliesPolicy = z.enum(['followed', 'list', 'none'])
export type ListRepliesPolicy = z.infer<typeof ListRepliesPolicy>

export const List = z.object({
  id: z.string(),
  actorId: z.string(),
  title: z.string(),
  repliesPolicy: ListRepliesPolicy,
  exclusive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type List = z.infer<typeof List>
