import { z } from 'zod'

export const Bookmark = z.object({
  id: z.string(),
  actorId: z.string(),
  statusId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type Bookmark = z.infer<typeof Bookmark>
