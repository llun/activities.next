import { z } from 'zod'

export const TagHistory = z.object({
  day: z.string(),
  uses: z.string(),
  accounts: z.string()
})
export type TagHistory = z.infer<typeof TagHistory>

export const Tag = z.object({
  name: z.string(),
  url: z.string(),
  history: TagHistory.array(),
  following: z.boolean().optional(),
  featuring: z.boolean().optional()
})
export type Tag = z.infer<typeof Tag>
