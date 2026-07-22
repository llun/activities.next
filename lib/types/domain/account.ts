import { z } from 'zod'

export const Account = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullish(),
  iconUrl: z.string().nullish(),
  passwordHash: z.string().nullish(),
  verificationCode: z.string().nullish(),
  passwordResetCode: z.string().nullish(),
  passwordResetCodeExpiresAt: z.number().nullish(),
  defaultActorId: z.string().nullish(),
  emailChangePending: z.string().nullish(),
  emailChangeCode: z.string().nullish(),
  emailChangeCodeExpiresAt: z.number().nullish(),
  emailVerifiedAt: z.number().nullish(),
  twoFactorEnabled: z.boolean().default(false),
  role: z.string().nullish(),
  // Moderation/registration state (Admin moderation API). Nullable epoch-ms
  // timestamps; optional so existing Account.parse call sites stay valid.
  disabledAt: z.number().nullish(),
  approvedAt: z.number().nullish(),

  createdAt: z.number(),
  updatedAt: z.number(),
  verifiedAt: z.number().optional()
})

export type Account = z.infer<typeof Account>
