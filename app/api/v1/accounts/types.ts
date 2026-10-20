import { z } from 'zod'

import { localUsernameSchema } from '@/lib/services/accounts/localUsername'
import { Booleanish } from '@/lib/utils/zodBooleanish'

export const CreateAccountRequest = z.object({
  username: localUsernameSchema,
  name: z.string().trim().max(255).optional(),
  // Normalized to lowercase so casing never creates duplicate accounts or
  // desyncs from case-insensitive lookups. Trim first, then lowercase, then
  // validate format/length on the canonical value.
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).trim(),
  // The sign-up form's "I agree to the terms of service and privacy policy"
  // checkbox, present only when the domain has either. Optional here so a
  // missing value reaches registerAccount, which decides whether it is needed
  // and answers with Mastodon's ERR_ACCEPTED.
  agreement: Booleanish.optional()
})
export type CreateAccountRequest = z.infer<typeof CreateAccountRequest>
