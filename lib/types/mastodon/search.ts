import { z } from 'zod'

import { Account } from './account'
import { Status } from './status'
import { Tag } from './status/tag'

export const Search = z.object({
  accounts: Account.array(),
  statuses: Status.array(),
  hashtags: Tag.array()
})
export type Search = z.infer<typeof Search>
