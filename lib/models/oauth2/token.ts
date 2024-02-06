import { z } from 'zod'

import { Scopes } from '@/lib/storage/types/oauth'

import { Client } from './client'

export const Token = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.number().transform((value) => new Date(value)),

  refreshToken: z.string().nullish(),
  refreshTokenExpiresAt: z
    .number()
    .nullish()
    .transform((value) => (value ? new Date(value) : null)),

  client: Client,
  scopes: Scopes.array().transform((scopes) =>
    scopes.map((name) => ({ name }))
  ),

  createdAt: z.number(),
  updatedAt: z.number()
})
