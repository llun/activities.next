// Parameter and result types of the customEmoji domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { CustomEmojiData } from '@/lib/types/domain/customEmoji'

export type CreateCustomEmojiParams = {
  shortcode: string
  url: string
  staticUrl: string
  category?: string | null
  visibleInPicker?: boolean
  disabled?: boolean
}

export type GetCustomEmojisParams = {
  // When false (default) only enabled emoji are returned. The admin surface
  // passes `true` to also list disabled emoji.
  includeDisabled?: boolean
}

export type UpdateCustomEmojiParams = {
  id: string
  category?: string | null
  visibleInPicker?: boolean
  disabled?: boolean
}

export interface CustomEmojiDatabase {
  createCustomEmoji(params: CreateCustomEmojiParams): Promise<CustomEmojiData>
  getCustomEmojis(params?: GetCustomEmojisParams): Promise<CustomEmojiData[]>
  getCustomEmojiById(id: string): Promise<CustomEmojiData | null>
  getCustomEmojiByShortcode(shortcode: string): Promise<CustomEmojiData | null>
  updateCustomEmoji(
    params: UpdateCustomEmojiParams
  ): Promise<CustomEmojiData | null>
  deleteCustomEmoji(id: string): Promise<CustomEmojiData | null>
}
