import { z } from 'zod'

import { Scope } from '@/lib/types/database/operations'

export const Client = z.object({
  id: z.string(),
  clientId: z.string(),
  clientSecret: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  redirectUris: z.string().url().array().min(1),
  scopes: Scope.array().default([Scope.enum.read]),
  website: z.string().nullable().optional(),
  requirePKCE: z.boolean().default(false),
  disabled: z.boolean().default(false),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type Client = z.infer<typeof Client>
