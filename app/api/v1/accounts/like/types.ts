import { z } from 'zod'

export const LikeStatusRequest = z.object({
  statusId: z.string()
})
export type LikeStatusRequest = z.infer<typeof LikeStatusRequest>
