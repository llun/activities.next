import { z } from 'zod'

/**
 * A Zod schema for Mastodon-style boolean params. JSON bodies send real
 * booleans, but form-encoded/multipart bodies send strings — and `Boolean('false')`
 * is truthy — so string values are coerced explicitly. Recognized truthy
 * strings: `true`, `1`, `on`, `yes` (case-insensitive); everything else is false.
 */
export const Booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value
    const normalized = value.trim().toLowerCase()
    return (
      normalized === 'true' ||
      normalized === '1' ||
      normalized === 'on' ||
      normalized === 'yes'
    )
  })
