/**
 * Fetches the unedited original (same origin, with credentials) and decodes it
 * to an `ImageBitmap` with no colour-space handling: stored files carry no
 * EXIF (`from-image` then changes nothing), and the maths is sRGB in, sRGB
 * out. With `expected`, a decoded size that differs from the one the server
 * reported is an error, so a mismatch cannot silently skew the crop.
 */
export const loadSource = async (
  url: string,
  signal?: AbortSignal,
  expected?: { width: number; height: number }
): Promise<ImageBitmap> => {
  const response = await fetch(url, { credentials: 'include', signal })
  if (!response.ok) throw new Error('Failed to load the photo.')
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: 'from-image',
    colorSpaceConversion: 'none'
  })
  if (
    expected &&
    (bitmap.width !== expected.width || bitmap.height !== expected.height)
  ) {
    bitmap.close?.()
    throw new Error('The photo does not match its stored size.')
  }
  return bitmap
}
