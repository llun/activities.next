import { z } from 'zod'

import { Image } from '../image'

export const Emoji = z.object({
  type: z.literal('Emoji'),
  id: z.string().optional(),
  name: z.string(),
  updated: z.string(),
  icon: Image
})

export type Emoji = z.infer<typeof Emoji>
