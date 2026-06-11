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
  email: z.string().email().trim().max(255),
  password: z.string().min(8).trim()
})
export type CreateAccountRequest = z.infer<typeof CreateAccountRequest>
