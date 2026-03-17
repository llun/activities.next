import crypto from 'crypto'
import { execFile } from 'child_process'
import fs from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const extractVideoImage = async (filePath: string): Promise<Buffer> => {
  const randomFileName = crypto.randomBytes(8).toString('hex')
  const tmpDir = tmpdir()
  const fileName = path.join(tmpDir, `${randomFileName}.jpg`)
  try {
    await execFileAsync('ffmpeg', [
      '-loglevel', 'error',
      '-i', path.resolve(filePath),
      '-frames:v', '1',
      '-y', fileName
    ])
    return await fs.readFile(fileName)
  } finally {
    await fs.unlink(fileName).catch(() => {})
  }
}
