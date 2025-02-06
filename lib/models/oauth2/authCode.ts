import { z } from 'zod'

import { Scope } from '@/lib/database/types/oauth'

import { Client } from './client'
import { User } from './user'

export const CodeChallengeMethod = z.enum(['S256', 'plain'])
export type CodeChallengeMethod = z.infer<typeof CodeChallengeMethod>

export const AuthCode = z.object({
  code: z.string(),
  redirectUri: z.string().nullish(),
  codeChallenge: z.string().nullish(),
  codeChallengeMethod: CodeChallengeMethod.nullish(),

  user: User.nullish(),
  client: Client,
  scopes: Scope.array().transform((scopes) => scopes.map((name) => ({ name }))),

  expiresAt: z.number().transform((value) => new Date(value)),
  createdAt: z.number(),
  updatedAt: z.number()
})

export type AuthCode = z.infer<typeof AuthCode>
