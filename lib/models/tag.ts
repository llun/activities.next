import { Mention } from '../activities/entities/mention'

export interface TagData {
  id: string
  statusId: string
  type: 'mention'
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
      type: 'Mention',
      name: data.name,
      href: data.value
    } as Mention
  }

  toJson(): TagData {
    return this.data
  }
}
