interface Params {
  url: string
  name?: string
}
export const MockImageDocument = ({ url, name }: Params) => {
  return {
    type: 'Document',
    mediaType: 'image/jpeg',
    url,
    name,
    blurhash: crypto.randomUUID(),
    focalPoint: [0.0, 0.0],
    width: 2000,
    height: 1500
  }
}
