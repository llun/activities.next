// This schema is based on https://docs.joinmastodon.org/entities/Report/
import { z } from 'zod'

import { Account } from './account'

export const ReportEntity = z.object({
  id: z.string(),
  action_taken: z.boolean(),
  action_taken_at: z.string().nullable(),
  category: z.enum(['spam', 'legal', 'violation', 'other']),
  comment: z.string(),
  forwarded: z.boolean(),
  created_at: z.string(),
  status_ids: z.array(z.string()).nullable(),
  rule_ids: z.array(z.string()).nullable(),
  target_account: Account
})
export type ReportEntity = z.infer<typeof ReportEntity>
