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
    ], { timeout: 30_000 })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    proc.on('close', (code, signal) => {
      if (code !== 0) {
        const reason = signal ? `killed by signal ${signal}` : `exited with code ${code}`
        return reject(new Error(`ffprobe ${reason}: ${stderr}`))
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (e) {
        reject(e)
      }
    })
    proc.on('error', reject)
    proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') reject(err)
    })
    proc.stdin.write(buffer)
    proc.stdin.end()
  })
}
