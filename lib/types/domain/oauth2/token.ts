import { z } from 'zod'

// Import from existing location until database types are migrated
import { Scope } from '@/lib/database/types/oauth'

import { Client } from './client'
import { User } from './user'

export const Token = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.number().transform((value) => new Date(value)),

  refreshToken: z.string().nullish(),
  refreshTokenExpiresAt: z
    .number()
    .nullish()
    .transform((value) => (value ? new Date(value) : null)),

  client: Client,
  scopes: Scope.array().transform((scopes) => scopes.map((name) => ({ name }))),
  user: User.nullish(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type Token = z.infer<typeof Token>
