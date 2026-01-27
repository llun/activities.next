import { z } from 'zod'

import { Note } from './content'

export const ENTITY_TYPE_LIKE = 'Like'
export const Like = z.object({
  type: z.literal(ENTITY_TYPE_LIKE),
  id: z.string(),
  actor: z.string(),
  object: z.union([z.string(), Note])
})

export type Like = z.infer<typeof Like>
