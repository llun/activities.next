import { z } from 'zod'

import { Mention } from '../activities/entities/mention'
import { TagType } from '../storage/types'

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
    return {
      type: [data.type[0].toUpperCase(), data.type.slice(1)].join(''),
      name: data.name,
      href: data.value
    } as Mention
  }

  toJson(): TagData {
    return this.data
  }
}
