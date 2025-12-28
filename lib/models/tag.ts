import { Mention } from '@llun/activities.schema'
import { z } from 'zod'

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

export const getMentionFromTag = (tag: Tag) =>
  Mention.parse({
    type: [tag.type[0].toUpperCase(), tag.type.slice(1)].join(''),
    name: tag.name,
    href: tag.value
  })
