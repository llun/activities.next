import sharp from 'sharp'

import { MediaValidationError } from './errors'

// A thumbnail is unvalidated client input on every path that accepts one:
// `FileSchema` checks the declared type against ACCEPTED_FILE_TYPES, which
// includes video and audio, and a declared type is only a claim in any case.
// Both storage drivers read one through here so the answer cannot differ by
// backend — that divergence is what this module exists to prevent.
//
// Returns the bytes, so the caller stores them without reading the file again.
export const readValidThumbnail = async (thumbnail: File): Promise<Buffer> => {
  if (!thumbnail.type.startsWith('image')) {
    throw new MediaValidationError('Thumbnail must be an image')
  }
  const buffer = Buffer.from(await thumbnail.arrayBuffer())
  try {
    // A full decode, not the cheaper `metadata()`: that parses the header, so
    // an image whose body is truncated passes it and fails only once the
    // encoder reaches the bytes that are not there — by which point the
    // original is stored and the failure is indistinguishable from a storage
    // fault of ours. Deciding it here keeps unusable input a 422 with nothing
    // written, and leaves every failure after it a genuine 500. It costs about
    // a sixth of the encode it precedes.
    await sharp(buffer).stats()
  } catch {
    throw new MediaValidationError('Thumbnail is not a readable image')
  }
  return buffer
}
