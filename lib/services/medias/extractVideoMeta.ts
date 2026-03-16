import { spawn } from 'child_process'

export interface FfprobeData {
  streams: {
    codec_type?: string
    width?: number
    height?: number
    [key: string]: unknown
  }[]
  format: {
    format_name?: string
    [key: string]: unknown
  }
}

export const extractVideoMeta = async (buffer: Buffer): Promise<FfprobeData> => {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      'pipe:0'
    ])
    let stdout = ''
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}`))
      try {
        resolve(JSON.parse(stdout))
      } catch (e) {
        reject(e)
      }
    })
    proc.on('error', reject)
    proc.stdin.write(buffer)
    proc.stdin.end()
  })
}
