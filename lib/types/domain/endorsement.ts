import { z } from 'zod'

// A profile endorsement (Mastodon "featured account"): the author actor
// (`actorId`) features the target actor (`targetActorId`) on their profile.
export const Endorsement = z.object({
  // Numeric string cursor used for Mastodon-style pagination of the
  // endorsement list endpoints.
  id: z.string(),
  actorId: z.string(),
  actorHost: z.string(),

  targetActorId: z.string(),
  targetActorHost: z.string(),

  createdAt: z.number()
})

export type Endorsement = z.infer<typeof Endorsement>
