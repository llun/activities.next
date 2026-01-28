import { z } from 'zod'

export const Account = z.object({
  id: z.string(),
  email: z.string(),
  passwordHash: z.string().nullish(),
  verificationCode: z.string().nullish(),
  defaultActorId: z.string().nullish(),
  emailChangePending: z.string().nullish(),
  emailChangeCode: z.string().nullish(),
  emailChangeCodeExpiresAt: z.number().nullish(),
  emailVerifiedAt: z.number().nullish(),

  createdAt: z.number(),
  updatedAt: z.number(),
  verifiedAt: z.number().optional()
})

export type Account = z.infer<typeof Account>
