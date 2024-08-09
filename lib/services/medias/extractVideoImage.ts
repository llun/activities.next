import crypto from 'crypto'
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { Readable } from 'stream'

export const extractVideoImage = async (
  readable: Readable
): Promise<Buffer> => {
  const randomFileName = crypto.randomBytes(8).toString('hex')
  const tmpDir = tmpdir()
  const fileName = path.join(tmpDir, `${randomFileName}.jpg`)
  return new Promise((resolve, reject) => {
    ffmpeg(readable)
      .frames(1)
      .output(fileName, { end: true })
      .on('end', async () => fs.readFile(fileName).then(resolve).catch(reject))
      .on('error', reject)
  })
}
