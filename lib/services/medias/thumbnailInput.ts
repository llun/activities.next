import { MediaValidationError } from './errors'
import { createStoredImagePipeline } from './storedImagePipeline'

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
    // written, and leaves every failure after it a genuine 500.
    //
    // Decoded to a pipeline output, and not with `stats()`. sharp learns why libvips failed from one process-wide error
    // buffer that every sharp call clears as it finishes, so under concurrent
    // load a failure can arrive with its message already gone. The pipeline
    // rejects regardless; `stats()` resolves with no channels instead, and let
    // truncated images through whenever other sharp calls were in flight.
    //
    // It decodes through the encode's own input pipeline, so it rejects what
    // the encode would, and its output is capped at the MAX box, so it does not
    // hold a full-resolution copy of an oversized image until it is collected.
    // It is also faster than `stats()`, which makes several passes.
    await createStoredImagePipeline(buffer).raw().toBuffer()
  } catch {
    throw new MediaValidationError('Thumbnail is not a readable image')
  }
  return buffer
}
