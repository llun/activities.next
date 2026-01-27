import { z } from 'zod'

import { Follow } from './follow'

export const Reject = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal('Reject'),
  object: Follow
})

export type Reject = z.infer<typeof Reject>
