// This schema is based on https://docs.joinmastodon.org/entities/Conversation/
import { z } from 'zod'

import { Account } from '@/lib/types/mastodon/account'
import { Status } from '@/lib/types/mastodon/status'

export const Conversation = z.object({
  id: z.string(),
  unread: z.boolean(),
  accounts: Account.array(),
  last_status: Status.nullable()
})
export type Conversation = z.infer<typeof Conversation>
