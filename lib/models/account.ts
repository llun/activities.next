import { z } from 'zod'

export const Account = z.object({
  id: z.string(),
  email: z.string(),
  passwordHash: z.string().optional(),
  verificationCode: z.string().optional(),

  createdAt: z.number(),
  updatedAt: z.number(),
  verifiedAt: z.number().optional()
})

export type Account = z.infer<typeof Account>
