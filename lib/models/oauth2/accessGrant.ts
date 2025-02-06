import { z } from 'zod'

export const AccessGrant = z.object({
  ownerId: z.string(),
  ownerType: z.string(),
  applicationUid: z.string(),
  redirectUri: z.string(),
  tenantName: z.string(),

  scopes: z.string().array(),
  token: z.string(),

  expiresIn: z.number(),
  createdAt: z.number(),
  revokedAt: z.number()
})
export type AccessGrant = z.infer<typeof AccessGrant>
