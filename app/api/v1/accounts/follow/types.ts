import { z } from 'zod'

export const FollowRequest = z.object({
  target: z.string()
})
export type FollowRequest = z.infer<typeof FollowRequest>
