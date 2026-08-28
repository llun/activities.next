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
  // better-auth's own verification column — the one that has actually gated
  // credential sign-in since 2026-03-20. On the domain object because
  // `isAccountConfirmationPending` reads it alongside `verificationCode`; see
  // that function for why neither column answers on its own.
  emailVerified: z.boolean().default(false),
  role: z.string().nullish(),
  // Moderation/registration state (Admin moderation API). Nullable epoch-ms
  // timestamps; optional so existing Account.parse call sites stay valid.
  disabledAt: z.number().nullish(),
  approvedAt: z.number().nullish(),

  createdAt: z.number(),
  updatedAt: z.number(),
  // Nullish, not optional: an account awaiting e-mail confirmation genuinely
  // has no `verifiedAt`, and both row-to-domain mappers hand the column
  // through as a literal `null` (`getActor` writes one; `toDomainAccount`
  // spreads the raw row). Under `z.number().optional()` that threw, so the
  // first request by an unconfirmed actor 500'd instead of loading.
  verifiedAt: z.number().nullish()
})

export type Account = z.infer<typeof Account>
