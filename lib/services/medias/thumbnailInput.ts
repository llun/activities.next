import sharp, { type Sharp } from 'sharp'

import { MediaValidationError } from './errors'

const assertPasses = async (
  file: File,
  check: (image: Sharp) => Promise<unknown>
) => {
  try {
    await check(sharp(Buffer.from(await file.arrayBuffer())))
  } catch {
    throw new MediaValidationError('Thumbnail is not a readable image')
  }
}

// A thumbnail is unvalidated client input on every path that accepts one:
// `FileSchema` checks the declared type against ACCEPTED_FILE_TYPES, which
// includes video and audio, and a declared type is only a claim in any case.
// Both storage drivers validate through here so the answer cannot differ by
// backend — that divergence is what this module exists to prevent.
//
// `metadata()` parses the header rather than decoding pixels, so this is cheap
// enough to run before anything is stored: bytes that are not an image at all
// are refused with nothing written.
export const assertReadableThumbnail = async (thumbnail: File) => {
  if (!thumbnail.type.startsWith('image')) {
    throw new MediaValidationError('Thumbnail must be an image')
  }
  await assertPasses(thumbnail, (image) => image.metadata())
}

// A full decode, for classifying a failure that happened while storing. An
// image whose header is intact but whose body is truncated passes the check
// above and only fails when the encoder reaches the missing bytes — this is
// what tells that apart from a storage fault of ours, which must keep its own
// error and stay a logged 500 rather than becoming a 422 the client will not
// retry.
export const assertThumbnailDecodable = async (thumbnail: File) => {
  await assertPasses(thumbnail, (image) => image.stats())
}
