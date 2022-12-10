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

export interface Attachment {
  id: string
  statusId: string
  type: 'Document'
  mediaType: string
  url: string
  width: number
  height: number
  name?: string

  createdAt: number
  updatedAt?: number
}
