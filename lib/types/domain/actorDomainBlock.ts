import { z } from 'zod'

export const ActorDomainBlock = z.object({
  id: z.string(),
  actorId: z.string(),
  // Normalized hostname (lowercase, no scheme/path). Compared against
  // `new URL(actorId).host` values at read sites.
  domain: z.string(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type ActorDomainBlock = z.infer<typeof ActorDomainBlock>
