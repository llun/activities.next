import { z } from 'zod'

import { InstanceRuleData } from '@/lib/types/database/operations'

// Body validation for the admin rules endpoints. The instance_rules text
// columns are unbounded `text`, so the caps here are product limits that keep
// rules readable rather than database constraints.
export const RuleCreateInput = z.object({
  text: z.string().trim().min(1).max(1000),
  hint: z.string().trim().max(2000).optional().default(''),
  position: z.coerce.number().int().min(0).optional()
})

// Partial update — every field is optional, but present fields must satisfy
// the same constraints as creation.
export const RuleUpdateInput = z.object({
  text: z.string().trim().min(1).max(1000).optional(),
  hint: z.string().trim().max(2000).optional(),
  position: z.coerce.number().int().min(0).optional()
})

// Admin shape — unlike the public Mastodon Rule entity this includes
// `position` so the admin panel can reorder rules by editing it.
export const getAdminRule = (rule: InstanceRuleData) => ({
  id: rule.id,
  text: rule.text,
  hint: rule.hint,
  position: rule.position
})
export type AdminRule = ReturnType<typeof getAdminRule>
