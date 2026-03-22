import { z } from 'zod'

export const CreateAccountRequest = z.object({
  username: z.string().regex(/\w+/).trim(),
  name: z.string().trim().max(255).optional(),
  email: z.string().email().trim(),
  password: z.string().min(8).trim()
})
export type CreateAccountRequest = z.infer<typeof CreateAccountRequest>
