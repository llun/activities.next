import { z } from 'zod'

import { InstanceRuleData } from '@/lib/types/database/operations'

// The instance_rules.position column is a signed 32-bit integer, so cap the
// input at its max. Without this a larger value overflows the column and
// surfaces as a 500 instead of a 422 validation error.
export const MAX_RULE_POSITION = 2147483647

// Body validation for the admin rules endpoints. The instance_rules text
// columns are unbounded `text`, so the caps here are product limits that keep
// rules readable rather than database constraints.
export const RuleCreateInput = z.object({
  text: z.string().trim().min(1).max(1000),
  hint: z.string().trim().max(2000).optional().default(''),
  position: z.coerce.number().int().min(0).max(MAX_RULE_POSITION).optional()
})

// Partial update — every field is optional, but present fields must satisfy
// the same constraints as creation. At least one field must be present so an
// empty body is rejected with 422 rather than silently performing a
// timestamp-only no-op update.
export const RuleUpdateInput = z
  .object({
    text: z.string().trim().min(1).max(1000).optional(),
    hint: z.string().trim().max(2000).optional(),
    position: z.coerce.number().int().min(0).max(MAX_RULE_POSITION).optional()
  })
  .refine(
    (data) =>
      data.text !== undefined ||
      data.hint !== undefined ||
      data.position !== undefined,
    { message: 'At least one of text, hint, or position must be provided' }
  )

// Admin shape — unlike the public Mastodon Rule entity this includes
// `position` so the admin panel can reorder rules by editing it.
export const getAdminRule = (rule: InstanceRuleData) => ({
  id: rule.id,
  text: rule.text,
  hint: rule.hint,
  position: rule.position
})
export type AdminRule = ReturnType<typeof getAdminRule>
