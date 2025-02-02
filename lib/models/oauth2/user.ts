import { z } from 'zod'

import { Account } from '@/lib/models/account'
import { Actor } from '@/lib/models/actor'

export const User = z.object({
  id: z.string(),
  actor: Actor,
  account: Account
})

export type User = z.infer<typeof User>
