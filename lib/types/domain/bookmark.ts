import { z } from 'zod'

export const Bookmark = z.object({
  id: z.string(),
  actorId: z.string(),
  statusId: z.string(),
  // The boost URI the bookmark was created through, when it was not the status itself
  sourceStatusId: z.string().nullish(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type Bookmark = z.infer<typeof Bookmark>
