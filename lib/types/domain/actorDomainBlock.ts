import { z } from 'zod'

export const ActorDomainBlock = z.object({
  id: z.string(),
  actorId: z.string(),
  // Normalized host (lowercase, no scheme/path, non-default port retained).
  // Stored via `normalizeActorHost` to match the `new URL(actorId).host` values
  // it is compared against at read sites.
  domain: z.string(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type ActorDomainBlock = z.infer<typeof ActorDomainBlock>
