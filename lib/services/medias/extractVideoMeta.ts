import ffmpeg from 'fluent-ffmpeg'
import { Readable } from 'stream'

export const extractVideoMeta = async (
  buffer: Buffer
): Promise<ffmpeg.FfprobeData> => {
  return new Promise((resolve, reject) => {
    ffmpeg(Readable.from(buffer)).ffprobe((error, data) => {
      if (error) return reject(error)
      resolve(data)
    })
  })
}
