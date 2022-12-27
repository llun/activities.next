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
      type: data.type,
      name: data.name,
      value: data.value
    }
  }
}
