// This schema is based on https://docs.joinmastodon.org/entities/Suggestion/
import { z } from 'zod'

import { Account } from '@/lib/types/mastodon/account'

export const Suggestion = z.object({
  source: z.enum(['staff', 'past_interactions', 'global']),
  sources: z
    .enum([
      'featured',
      'most_followed',
      'most_interactions',
      'similar_to_recently_followed',
      'friends_of_friends'
    ])
    .array(),
  account: Account
})
export type Suggestion = z.infer<typeof Suggestion>
