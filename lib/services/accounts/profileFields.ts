import { z } from 'zod'

import {
  PROFILE_FIELD_LIMIT,
  PROFILE_FIELD_NAME_MAX_LENGTH,
  PROFILE_FIELD_VALUE_MAX_LENGTH
} from '@/lib/services/accounts/profileFieldLimits'

const ProfileFieldPair = z.object({
  name: z.string().trim().max(PROFILE_FIELD_NAME_MAX_LENGTH),
  value: z.string().trim().max(PROFILE_FIELD_VALUE_MAX_LENGTH)
})

const FIELD_KEY = /^fields\[(\d+)\]\[(name|value)\]$/

export type ProfileFieldsFormResult =
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'ok'; fields: { name: string; value: string }[] }

/**
 * Reads the settings form's profile links (`fields[0][name]`,
 * `fields[0][value]`, ...). A form that sends none leaves the stored fields
 * alone (`absent`). A row with both parts empty is dropped; a row with only one
 * part, a row over the limits, or more than four rows is `invalid`.
 */
export const parseProfileFieldsForm = (
  form: Record<string, unknown>
): ProfileFieldsFormResult => {
  const rows = new Map<number, { name?: string; value?: string }>()
  for (const [key, raw] of Object.entries(form)) {
    const match = key.match(FIELD_KEY)
    if (!match) continue
    if (typeof raw !== 'string') return { status: 'invalid' }
    const index = Number(match[1])
    const row = rows.get(index) ?? {}
    row[match[2] as 'name' | 'value'] = raw
    rows.set(index, row)
  }
  if (rows.size === 0) return { status: 'absent' }
  if (rows.size > PROFILE_FIELD_LIMIT) return { status: 'invalid' }

  const fields: { name: string; value: string }[] = []
  for (const [, row] of [...rows.entries()].sort(([a], [b]) => a - b)) {
    const parsed = ProfileFieldPair.safeParse({
      name: row.name ?? '',
      value: row.value ?? ''
    })
    if (!parsed.success) return { status: 'invalid' }
    const { name, value } = parsed.data
    if (!name && !value) continue
    if (!name || !value) return { status: 'invalid' }
    fields.push({ name, value })
  }
  return { status: 'ok', fields }
}
