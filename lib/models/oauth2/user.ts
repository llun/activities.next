import { z } from 'zod'

import { Account } from '../account'
import { ActorData } from '../actor'

export const User = z.object({
  id: z.string(),
  actor: ActorData,
  account: Account
})

export type User = z.infer<typeof User>
