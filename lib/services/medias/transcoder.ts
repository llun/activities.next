import crypto from 'crypto'
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

export const transcodeMedia = async (inputPath: string): Promise<Buffer> => {
  return await new Promise((resolve, reject) => {
    const randomFileName = crypto.randomBytes(8).toString('hex')
    const tmpDir = tmpdir()
    const fileName = path.join(tmpDir, `${randomFileName}.webm`)
    ffmpeg(inputPath)
      .on('end', async () => fs.readFile(fileName).then(resolve).catch(reject))
      .on('error', reject)
      .fps(30)
      .output(fileName, { end: true })
      .run()
  })
}
