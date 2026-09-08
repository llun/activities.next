import type { AdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import type { CustomEmoji } from '@/lib/types/mastodon/customEmoji'

// Public instance custom emoji (picker-visible, enabled). Used by the postbox
// sticker/emoji picker. Returns [] on failure so the picker degrades to system
// emoji only.
export const getCustomEmojis = async (): Promise<CustomEmoji[]> => {
  try {
    const response = await fetch('/api/v1/custom_emojis', {
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) return []
    return (await response.json()) as CustomEmoji[]
  } catch {
    return []
  }
}

export const adminListCustomEmojis = async (): Promise<AdminCustomEmoji[]> => {
  const response = await fetch('/api/v1/admin/custom_emojis', {
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) throw new Error('Failed to load custom emoji')
  return (await response.json()) as AdminCustomEmoji[]
}

export interface AdminCreateCustomEmojiParams {
  shortcode: string
  image: File
  category?: string
  visibleInPicker?: boolean
}

export const adminCreateCustomEmoji = async ({
  shortcode,
  image,
  category,
  visibleInPicker
}: AdminCreateCustomEmojiParams): Promise<AdminCustomEmoji> => {
  const form = new FormData()
  form.set('shortcode', shortcode)
  form.set('image', image)
  if (category) form.set('category', category)
  if (visibleInPicker !== undefined) {
    form.set('visible_in_picker', visibleInPicker ? 'true' : 'false')
  }
  const response = await fetch('/api/v1/admin/custom_emojis', {
    method: 'POST',
    body: form
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'Failed to create custom emoji')
  }
  return (await response.json()) as AdminCustomEmoji
}

export interface AdminUpdateCustomEmojiParams {
  id: string
  category?: string | null
  visibleInPicker?: boolean
  disabled?: boolean
}

export const adminUpdateCustomEmoji = async ({
  id,
  category,
  visibleInPicker,
  disabled
}: AdminUpdateCustomEmojiParams): Promise<AdminCustomEmoji> => {
  const response = await fetch(`/api/v1/admin/custom_emojis/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(category !== undefined ? { category } : {}),
      ...(visibleInPicker !== undefined
        ? { visible_in_picker: visibleInPicker }
        : {}),
      ...(disabled !== undefined ? { disabled } : {})
    })
  })
  if (!response.ok) throw new Error('Failed to update custom emoji')
  return (await response.json()) as AdminCustomEmoji
}

export const adminDeleteCustomEmoji = async (id: string): Promise<void> => {
  const response = await fetch(`/api/v1/admin/custom_emojis/${id}`, {
    method: 'DELETE'
  })
  if (!response.ok) throw new Error('Failed to delete custom emoji')
}
