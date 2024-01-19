import { z } from 'zod'

export const OAuth2Token = z.object({
  ownerId: z.string(),
  ownerType: z.string(),
  applicationUid: z.string(),
  tenantName: z.string(),

  scopes: z.string().array(),
  token: z.string(),
  refreshToken: z.string(),
  previousRefreshToken: z.string(),

  expiresIn: z.number(),
  createdAt: z.number(),
  revokedAt: z.number()
})
