import { Mention } from '@llun/activities.schema'
import { z } from 'zod'

export const TagType = z.enum(['emoji', 'mention'])
export type TagType = z.infer<typeof TagType>

export const TagData = z.object({
  id: z.string(),
  statusId: z.string(),
  type: TagType,
  name: z.string(),
  value: z.string(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type TagData = z.infer<typeof TagData>

export class Tag {
  readonly data: TagData
  constructor(params: TagData) {
    this.data = TagData.parse(params)
  }

  toObject() {
    const data = this.data
    return Mention.parse({
      type: [data.type[0].toUpperCase(), data.type.slice(1)].join(''),
      name: data.name,
      href: data.value
    })
  }

  toJson(): TagData {
    return this.data
  }
}
