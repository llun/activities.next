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
  // `wx` (O_EXCL) so this fails rather than following a symlink someone planted
  // at the path, or clobbering an existing file. The 64-bit random prefix
  // already makes that infeasible to aim at; this makes it impossible.
  const tempFile = await fs.open(tempFilePath, 'wx')
  // Opening is what creates the file, so everything past it owns the path and
  // the cleanup below is safe — whereas a `try` that also covered the open
  // would delete the other file on an EEXIST collision, which is the one case
  // where the path is not ours. Cleanup has to start here rather than at the
  // extraction: a write that fails after the file exists (ENOSPC partway
  // through a 200MB upload) leaks the partial copy for the lifetime of the
  // container otherwise, and every retry adds another one.
  try {
    await tempFile.writeFile(buffer)
    // Close before handing the path to ffmpeg rather than holding the
    // descriptor open across the whole decode.
    await tempFile.close()
    return await extractVideoImage(tempFilePath)
  } finally {
    await tempFile.close().catch(() => undefined)
    await fs.unlink(tempFilePath).catch(() => undefined)
  }
}
