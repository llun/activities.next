// This schema is based on
// https://docs.joinmastodon.org/entities/FamiliarFollowers/
import { z } from 'zod'

import { Account } from '@/lib/types/mastodon/account'

export const FamiliarFollowers = z.object({
  id: z.string().describe('The ID of the Account in the database'),
  accounts: Account.array().describe(
    'Accounts you follow that also follow this account'
  )
})
export type FamiliarFollowers = z.infer<typeof FamiliarFollowers>
