export interface Document {
  type: 'Document'
  mediaType: string
  url: string
  name: string | null
  blurhash: string
  width: number
  height: number
}
