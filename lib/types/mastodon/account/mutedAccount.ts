// This schema is based on https://docs.joinmastodon.org/entities/MutedAccount/
// MutedAccount is the Account shape returned by GET /api/v1/mutes: a plain
// Account plus when the mute expires (null when the mute is indefinite).
import { z } from 'zod'

import { Account } from '@/lib/types/mastodon/account'

export const MutedAccount = Account.extend({
  mute_expires_at: z
    .string()
    .describe(
      'When a timed mute will expire in ISO 8601 Datetime format, if applicable'
    )
    .nullable()
})
export type MutedAccount = z.infer<typeof MutedAccount>
