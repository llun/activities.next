import { z } from 'zod'

import { GrantIdentifiers, Scopes } from '@/lib/storage/types/oauth2'

export const OAuth2Application = z.object({
  id: z.string(),
  name: z.string(),
  secret: z.string(),
  redirectUris: z.string().url().array().min(1),
  scopes: Scopes.array()
    .default(['read'])
    .transform((value) => value.map((scope) => ({ name: scope }))),
  allowedGrants: GrantIdentifiers.array().default([
    'authorization_code',
    'refresh_token'
  ]),
  website: z.string().optional(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type OAuth2Application = z.infer<typeof OAuth2Application>
