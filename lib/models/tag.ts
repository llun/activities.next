import { Mention } from '../activities/entities/mention'
import { TagType } from '../storage/types'

export interface TagData {
  id: string
  statusId: string
  type: TagType
  name: string
  value: string

  createdAt: number
  updatedAt: number
}

export class Tag {
  readonly data: TagData
  constructor(params: TagData) {
    this.data = params
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
