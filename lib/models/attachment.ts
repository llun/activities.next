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
