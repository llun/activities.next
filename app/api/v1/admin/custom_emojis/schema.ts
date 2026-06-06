import { z } from 'zod'

import { CUSTOM_EMOJI_SHORTCODE_REGEX } from '@/lib/types/domain/customEmoji'

// Accepts JSON booleans and the string forms multipart/form-data carries.
const Booleanish = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === 'boolean') return value
  const normalized = value.toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'on'
})

// Shortcode without colons. `^[a-zA-Z0-9_]+$` per the Mastodon CustomEmoji
// entity; capped so it fits the `varchar` column.
const Shortcode = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(CUSTOM_EMOJI_SHORTCODE_REGEX)

const Category = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((value) => value || null)

// `POST /api/v1/admin/custom_emojis` — multipart form fields alongside the
// uploaded `image` file (validated separately through the media pipeline).
export const CreateCustomEmojiRequest = z.object({
  shortcode: Shortcode,
  category: Category,
  visible_in_picker: Booleanish.optional()
})

// `PATCH`/`PUT /api/v1/admin/custom_emojis/:id` — update moderation fields.
export const UpdateCustomEmojiRequest = z.object({
  // Accepts a string, `null` (clear the category), or omitted (preserve). The
  // admin UI sends `null` when the category field is cleared.
  category: z
    .string()
    .trim()
    .max(255)
    .nullable()
    .transform((value) => value || null)
    .optional(),
  visible_in_picker: Booleanish.optional(),
  disabled: Booleanish.optional()
})
