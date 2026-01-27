import { z } from 'zod'

export const HashTag = z.object({
  type: z.literal('Hashtag'),
  href: z.string().url(),
  name: z.string().startsWith('#')
})

export type HashTag = z.infer<typeof HashTag>
