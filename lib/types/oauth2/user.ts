import { z } from 'zod'

import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'

export const User = z.object({
  id: z.string(),
  actor: Actor,
  account: Account
})

export type User = z.infer<typeof User>
