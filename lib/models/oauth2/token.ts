import { z } from 'zod'

import { Scopes } from '@/lib/storage/types/oauth'

export const Token = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.number().transform((value) => new Date(value)),

  refreshToken: z.string().nullish(),
  refreshTokenExpiresAt: z
    .number()
    .nullish()
    .transform((value) => (value ? new Date(value) : null)),

  applicationId: z.string(),
  accountId: z.string(),
  scopes: Scopes.array(),

  createdAt: z.number(),
  updatedAt: z.number()
})
