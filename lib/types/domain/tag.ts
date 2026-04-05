import { z } from 'zod'

import {
  type Tag as ActivityPubTag,
  HashTag,
  Mention
} from '@/lib/types/activitypub/objects'

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

export const getMentionFromTag = (tag: Tag): ActivityPubTag | null => {
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
