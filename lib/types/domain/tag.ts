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

export const getMentionFromTag = (tag: Tag): ActivityPubTag => {
  if (tag.type === 'hashtag') {
    return HashTag.parse({
      type: 'Hashtag',
      name: tag.name,
      href: tag.value
    })
  }
  return Mention.parse({
    type: 'Mention',
    name: tag.name,
    href: tag.value
  })
}
