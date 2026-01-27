import { z } from 'zod'

export const ENTITY_TYPE_TOMBSTONE = 'Tombstone'
export const Tombstone = z.object({
  type: z.literal(ENTITY_TYPE_TOMBSTONE),
  id: z.string()
})
export type Tombstone = z.infer<typeof Tombstone>
