export interface Document {
  type: 'Document'
  mediaType: string
  url: string
  blurhash?: string
  width?: number
  height?: number
  name?: string | null
  focalPoint?: [number, number]
}
