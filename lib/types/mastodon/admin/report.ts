// This schema is based on https://docs.joinmastodon.org/entities/Admin_Report/
import { z } from 'zod'

import { AdminAccount } from '@/lib/types/mastodon/admin/account'
import { Rule } from '@/lib/types/mastodon/rule'
import { Status } from '@/lib/types/mastodon/status'

export const AdminReport = z.object({
  // Report ids stay the raw UUIDs POST /api/v1/reports returns.
  id: z.string(),
  action_taken: z.boolean(),
  action_taken_at: z.string().nullable(),
  category: z.enum(['spam', 'legal', 'violation', 'other']),
  comment: z.string(),
  forwarded: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  // The four embedded Admin::Accounts; assigned/action_taken_by are null when
  // unset.
  account: AdminAccount,
  target_account: AdminAccount,
  assigned_account: AdminAccount.nullable(),
  action_taken_by_account: AdminAccount.nullable(),
  statuses: z.array(Status),
  rules: z.array(Rule)
})
export type AdminReport = z.infer<typeof AdminReport>
