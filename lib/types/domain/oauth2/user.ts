import { z } from 'zod'

import { Account } from '../account'
import { Actor } from '../actor'

export const User = z.object({
  id: z.string(),
  actor: Actor,
  account: Account
})

export type User = z.infer<typeof User>
