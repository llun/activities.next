import { z } from 'zod'

import { CustomEmoji as MastodonCustomEmoji } from '@/lib/types/mastodon/customEmoji'

// Shortcode without the surrounding colons. Matches Mastodon's allowed
// characters for custom emoji shortcodes.
export const CUSTOM_EMOJI_SHORTCODE_REGEX = /^[a-zA-Z0-9_]+$/

// Instance-scoped custom emoji as stored in the `customEmojis` table. `name`
// federation and picker rendering go through the Mastodon/ActivityPub mappers
// below.
export const CustomEmojiData = z.object({
  id: z.string(),
  shortcode: z.string(),
  url: z.string(),
  staticUrl: z.string(),
  category: z.string().nullable(),
  visibleInPicker: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type CustomEmojiData = z.infer<typeof CustomEmojiData>

// Maps a stored custom emoji to the Mastodon `CustomEmoji` entity returned by
// `GET /api/v1/custom_emojis`. See
// https://docs.joinmastodon.org/entities/CustomEmoji/.
export const toMastodonCustomEmoji = (
  emoji: CustomEmojiData
): MastodonCustomEmoji => ({
  shortcode: emoji.shortcode,
  url: emoji.url,
  static_url: emoji.staticUrl,
  visible_in_picker: emoji.visibleInPicker,
  category: emoji.category
})

export interface AdminCustomEmoji extends MastodonCustomEmoji {
  id: string
  disabled: boolean
}

// Admin surface representation: the public entity plus the moderation-only `id`
// and `disabled` fields the admin endpoints and management page need.
export const toAdminCustomEmoji = (
  emoji: CustomEmojiData
): AdminCustomEmoji => ({
  ...toMastodonCustomEmoji(emoji),
  id: emoji.id,
  disabled: emoji.disabled
})
