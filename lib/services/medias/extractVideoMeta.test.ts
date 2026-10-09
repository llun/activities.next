import { spawn } from 'child_process'
import { EventEmitter } from 'events'

import { extractVideoMeta, extractVideoMetaFromFile } from './extractVideoMeta'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

class FakeStdin extends EventEmitter {
  write = vi.fn()
  end = vi.fn()
}

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = new FakeStdin()
}

const PROBE_OUTPUT = {
  streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }
}

const startProbe = () => {
  const proc = new FakeProcess()
  vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>)
  return proc
}

describe('extractVideoMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pipes the buffer to ffprobe on stdin and resolves with its JSON output', async () => {
    const proc = startProbe()
    const buffer = Buffer.from('video-bytes')

    const pending = extractVideoMeta(buffer)
    proc.stdout.emit('data', Buffer.from(JSON.stringify(PROBE_OUTPUT)))
    proc.emit('close', 0, null)

    await expect(pending).resolves.toEqual(PROBE_OUTPUT)
    expect(spawn).toHaveBeenCalledWith(
      'ffprobe',
      [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        'pipe:0'
      ],
      { timeout: 30_000 }
    )
    expect(proc.stdin.write).toHaveBeenCalledWith(buffer)
    expect(proc.stdin.end).toHaveBeenCalledTimes(1)
  })

  it('joins JSON that ffprobe prints across several stdout chunks', async () => {
    const proc = startProbe()
    const json = JSON.stringify(PROBE_OUTPUT)

    const pending = extractVideoMeta(Buffer.from('x'))
    proc.stdout.emit('data', Buffer.from(json.slice(0, 20)))
    proc.stdout.emit('data', Buffer.from(json.slice(20)))
    proc.emit('close', 0, null)

    await expect(pending).resolves.toEqual(PROBE_OUTPUT)
  })

  it('rejects with the exit code and stderr when ffprobe exits non-zero', async () => {
    const proc = startProbe()

    const pending = extractVideoMeta(Buffer.from('not-a-video'))
    proc.stderr.emit('data', Buffer.from('Invalid data found'))
    proc.emit('close', 1, null)

    await expect(pending).rejects.toThrow(
      'ffprobe exited with code 1: Invalid data found'
    )
  })

  it('reports the signal when ffprobe is killed, such as by the 30s timeout', async () => {
    const proc = startProbe()

    const pending = extractVideoMeta(Buffer.from('x'))
    proc.emit('close', null, 'SIGTERM')

    await expect(pending).rejects.toThrow('ffprobe killed by signal SIGTERM')
  })

  it('rejects when ffprobe succeeds but prints something that is not JSON', async () => {
    const proc = startProbe()

    const pending = extractVideoMeta(Buffer.from('x'))
    proc.stdout.emit('data', Buffer.from('not json'))
    proc.emit('close', 0, null)

    await expect(pending).rejects.toBeInstanceOf(SyntaxError)
  })

  it('rejects when ffprobe cannot be started', async () => {
    const proc = startProbe()
    const failure = Object.assign(new Error('spawn ffprobe ENOENT'), {
      code: 'ENOENT'
    })

    const pending = extractVideoMeta(Buffer.from('x'))
    proc.emit('error', failure)

    await expect(pending).rejects.toBe(failure)
  })

  it('ignores EPIPE on stdin, which is how ffprobe stops reading once it has enough', async () => {
    const proc = startProbe()

    const pending = extractVideoMeta(Buffer.from('x'))
    proc.stdin.emit(
      'error',
      Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    )
    proc.stdout.emit('data', Buffer.from(JSON.stringify(PROBE_OUTPUT)))
    proc.emit('close', 0, null)

    await expect(pending).resolves.toEqual(PROBE_OUTPUT)
  })

  it('rejects on any other stdin error', async () => {
    const proc = startProbe()
    const failure = Object.assign(new Error('write EIO'), { code: 'EIO' })

    const pending = extractVideoMeta(Buffer.from('x'))
    proc.stdin.emit('error', failure)

    await expect(pending).rejects.toBe(failure)
  })
})

describe('extractVideoMetaFromFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('probes the file path directly and writes nothing to stdin', async () => {
    const proc = startProbe()

    const pending = extractVideoMetaFromFile('/tmp/media/upload.mp4')
    proc.stdout.emit('data', Buffer.from(JSON.stringify(PROBE_OUTPUT)))
    proc.emit('close', 0, null)

    await expect(pending).resolves.toEqual(PROBE_OUTPUT)
    expect(vi.mocked(spawn).mock.calls[0][1]?.at(-1)).toBe(
      '/tmp/media/upload.mp4'
    )
    expect(proc.stdin.write).not.toHaveBeenCalled()
    expect(proc.stdin.end).toHaveBeenCalledTimes(1)
  })

  it('rejects with the exit code when ffprobe cannot read the file', async () => {
    const proc = startProbe()

    const pending = extractVideoMetaFromFile('/tmp/media/missing.mp4')
    proc.stderr.emit('data', Buffer.from('No such file'))
    proc.emit('close', 1, null)

    await expect(pending).rejects.toThrow(
      'ffprobe exited with code 1: No such file'
    )
  })
})
