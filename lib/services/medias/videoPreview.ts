import fs from 'fs/promises'

import { extractVideoImage } from './extractVideoImage'
import { createMediaTempFilePath } from './fileName'

/**
 * Reads the preview frame for an uploaded video from a temp copy, removing that
 * copy again on every path.
 *
 * Both storage drivers extract the frame *before* they store the video, so a
 * clip ffmpeg cannot decode never reaches the media root or the bucket: a
 * stored file with no `medias` row is unreachable by everything except
 * `scripts/maintenance/cleanupMediaStorage.ts`. Keeping the step here is what
 * stops the two drivers drifting apart on it again.
 *
 * `extension` comes from the already-validated content type, and the temp name
 * carries no part of the supplied file name. ffmpeg chooses its demuxer from
 * the path as well as from the bytes, and `image2`/`mjpeg` beat content probing
 * for a name that pairs an image extension with a `%0Nd` or `*` pattern — so an
 * upload named `IMG_%04d.jpg` sent ffmpeg looking for a numbered image sequence
 * and failed to open a perfectly good mp4.
 */
export const extractVideoPreviewFrame = async (
  buffer: Buffer,
  extension: string
): Promise<Buffer> => {
  const tempFilePath = createMediaTempFilePath(`video${extension}`)
  // `wx` (O_EXCL) so the write fails rather than following a symlink someone
  // planted at the path, or clobbering an existing file. The 64-bit random
  // prefix already makes that infeasible to aim at; this makes it impossible.
  await fs.writeFile(tempFilePath, buffer, { flag: 'wx' })
  // `finally` so a failed extraction still removes the temp copy instead of
  // leaking it for the lifetime of the container.
  return extractVideoImage(tempFilePath).finally(() =>
    fs.unlink(tempFilePath).catch(() => undefined)
  )
}
