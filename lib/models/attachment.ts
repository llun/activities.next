export interface AppleGalleryAttachment {
  type: 'apple'
  guid: string
  mediaType: string
  url: string
  width: number
  height: number
  name?: string
}

export type PostBoxAttachment = AppleGalleryAttachment

export interface AttachmentData {
  id: string
  statusId: string
  type: 'Document'
  mediaType: string
  url: string
  width: number
  height: number
  name: string

  createdAt: number
  updatedAt: number
}

export class Attachment {
  readonly id: string
  readonly statusId: string
  readonly mediaType: string
  readonly url: string
  readonly width: number
  readonly height: number
  readonly name: string

  readonly createdAt: number
  readonly updatedAt: number

  constructor(params: AttachmentData) {
    this.id = params.id
    this.statusId = params.id
    this.mediaType = params.mediaType
    this.url = params.url
    this.width = params.width
    this.height = params.height
    this.name = params.name || ''

    this.createdAt = params.createdAt
    this.updatedAt = params.updatedAt
  }

  toObject() {
    return {
      type: 'Document',
      mediaType: this.mediaType,
      url: this.url,
      width: this.width,
      height: this.height,
      name: this.name
    }
  }
}
