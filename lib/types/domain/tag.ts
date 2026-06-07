import { z } from 'zod'

import {
  type Tag as ActivityPubTag,
  Emoji,
  HashTag,
  Mention
} from '@/lib/types/activitypub/objects'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const TagType = z.enum(['emoji', 'mention', 'hashtag'])
export type TagType = z.infer<typeof TagType>

export const Tag = z.object({
  id: z.string(),
  statusId: z.string(),
  type: TagType,
  name: z.string(),
  value: z.string(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type Tag = z.infer<typeof Tag>

// Converts mention/hashtag domain tags into their outgoing ActivityPub tag
// objects. Emoji tags are handled by `getEmojiFromTag` and return `null` here so
// they are not mis-serialized as `Mention` objects (a `Mention.safeParse` of an
// emoji tag would otherwise succeed because both have string `name`/`href`).
export const getMentionFromTag = (tag: Tag): ActivityPubTag | null => {
  if (tag.type === 'emoji') return null
  if (tag.type === 'hashtag') {
    const result = HashTag.safeParse({
      type: 'Hashtag',
      name: tag.name.startsWith('#') ? tag.name : `#${tag.name}`,
      href: tag.value
    })
    return result.success ? result.data : null
  }
  const result = Mention.safeParse({
    type: 'Mention',
    name: tag.name,
    href: tag.value
  })
  return result.success ? result.data : null
}

// Converts an emoji domain tag (`name = ':shortcode:'`, `value = image url`)
// into an ActivityPub `Emoji` tag so Mastodon and other AP servers render the
// custom emoji. Mastodon matches inbound emoji on `name` + `icon.url`; `id` and
// `updated` drive caching, so we use the image URL as a stable `id`. See
// https://docs.joinmastodon.org/spec/activitypub/#Emoji.
export const getEmojiFromTag = (tag: Tag): Emoji | null => {
  if (tag.type !== 'emoji') return null
  const result = Emoji.safeParse({
    type: 'Emoji',
    id: tag.value,
    name: tag.name,
    updated: getISOTimeUTC(tag.updatedAt),
    icon: {
      type: 'Image',
      url: tag.value
    }
  })
  return result.success ? result.data : null
}
