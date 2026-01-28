import { z } from 'zod'

import { GrantIdentifiers, Scope } from '@/lib/types/database/operations'

export const Client = z.object({
  id: z.string(),
  name: z.string(),
  secret: z.string(),
  redirectUris: z.string().url().array().min(1),
  scopes: Scope.array()
    .default([Scope.enum.read])
    .transform((value) => value.map((scope) => ({ name: scope }))),
  allowedGrants: GrantIdentifiers.array().default([
    'client_credentials',
    'authorization_code',
    'refresh_token'
  ]),
  website: z.string().optional(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type Client = z.infer<typeof Client>
