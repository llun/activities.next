import crypto from 'crypto'

import { Document } from '../activities/entities/document'

interface Params {
  url: string
  name?: string
  mediaType?: string
  width?: number
  height?: number
  blurhash?: string
  focalPoint?: [number, number]
}
export const MockImageDocument = ({
  url,
  name,
  mediaType,
  width,
  height,
  blurhash,
  focalPoint
}: Params) => {
  return {
    type: 'Document',
    mediaType: mediaType ?? 'image/jpeg',
    url,
    name,
    blurhash: blurhash ?? crypto.randomUUID(),
    focalPoint: focalPoint ?? [0.0, 0.0],
    width: width ?? 2000,
    height: height ?? 1500
  } as Document
}
