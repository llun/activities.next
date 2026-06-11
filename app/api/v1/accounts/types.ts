import { z } from 'zod'

import { isFederationSigningActorUsername } from '@/lib/services/federation/instanceActor'

export const CreateAccountRequest = z.object({
  username: z
    .string()
    .regex(/\w+/)
    .trim()
    .refine((username) => !isFederationSigningActorUsername(username), {
      message: 'Username is reserved'
    }),
  name: z.string().trim().max(255).optional(),
  // Normalized to lowercase so casing never creates duplicate accounts or
  // desyncs from case-insensitive lookups. Trim first, then lowercase, then
  // validate format/length on the canonical value.
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).trim()
})
export type CreateAccountRequest = z.infer<typeof CreateAccountRequest>
