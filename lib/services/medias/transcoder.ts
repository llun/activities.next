import { randomBytes } from 'crypto'
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

export const transcodeMedia = async () => {
  return await new Promise((resolve, reject) => {
    const fileName = path.join(
      tmpdir(),
      randomBytes(32).toString('hex') + '.webm'
    )
    ffmpeg('IMG_1634.mov')
      .on('end', () => {
        fs.readFile(fileName).then(resolve).catch(reject)
      })
      .on('error', reject)
      .fps(30)
      .outputOption(['-preset ultrafast', '-deadline realtime'])
      .output(fileName)
      .run()
  })
}
