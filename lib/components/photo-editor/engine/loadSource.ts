/**
 * Fetches the unedited original (same origin, with credentials) and decodes it
 * to an `ImageBitmap` with no orientation or colour-space handling: stored
 * files carry no EXIF, and the maths is sRGB in, sRGB out.
 */
export const loadSource = async (
  url: string,
  signal?: AbortSignal
): Promise<ImageBitmap> => {
  const response = await fetch(url, { credentials: 'include', signal })
  if (!response.ok) throw new Error('Failed to load the photo.')
  const blob = await response.blob()
  return createImageBitmap(blob, {
    imageOrientation: 'none',
    colorSpaceConversion: 'none'
  })
}
