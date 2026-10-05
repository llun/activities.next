import { execFile } from 'child_process'
import crypto from 'crypto'
import fs from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Fit inside a 1280px box (never upscaling, aspect kept, even dimensions for
// the encoder), then pick the representative frame from a batch of 50.
export const VIDEO_PREVIEW_FILTER =
  "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,thumbnail=n=50"

export const extractVideoImage = async (filePath: string): Promise<Buffer> => {
  const randomFileName = crypto.randomBytes(8).toString('hex')
  const tmpDir = tmpdir()
  const fileName = path.join(tmpDir, `${randomFileName}.jpg`)
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-loglevel',
        'error',
        // Fewer decoder threads, fewer frames in flight at input resolution.
        '-threads',
        '2',
        '-i',
        path.resolve(filePath),
        // `thumbnail` analyses batches of candidate frames and emits the most
        // representative one. Without it ffmpeg takes the first decodable frame,
        // which for a clip that opens on black or a blank frame is what gets
        // stored as the poster and fed to the alt-text model.
        //
        // It holds its whole batch uncompressed, so the frames are scaled down
        // FIRST and the batch is kept small: at its default 100 frames and
        // input resolution, a short 4K clip peaked at ~1.6 GB resident and 8K
        // at several times that, from an upload well under the byte cap.
        '-vf',
        VIDEO_PREVIEW_FILTER,
        '-frames:v',
        '1',
        // A single-frame image2 output has no sequence pattern in its name and
        // would otherwise emit an image2 warning. It still writes the file, and
        // `-loglevel error` hides the warning anyway, so this is kept to make the
        // single-overwritten-file intent explicit rather than as a hard
        // requirement.
        '-update',
        '1',
        '-y',
        fileName
      ],
      { timeout: 30_000 }
    )
    return await fs.readFile(fileName)
  } finally {
    await fs.unlink(fileName).catch(() => {})
  }
}
