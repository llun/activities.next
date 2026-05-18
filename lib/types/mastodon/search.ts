import { z } from 'zod'

import { Account } from './account'
import { Status } from './status'
import { SearchTag } from './status/tag'

export const Search = z.object({
  accounts: Account.array(),
  statuses: Status.array(),
  hashtags: SearchTag.array()
})
export type Search = z.infer<typeof Search>
