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
  readonly data: AttachmentData

  constructor(params: AttachmentData) {
    this.data = params
  }

  toObject() {
    const data = this.data
    return {
      type: 'Document',
      mediaType: data.mediaType,
      url: data.url,
      width: data.width,
      height: data.height,
      name: data.name
    }
  }

  toJson(): AttachmentData {
    return this.data
  }
}
