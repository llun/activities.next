import { ChildProcess, ExecException, execFile } from 'child_process'
import fs from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

import { extractVideoImage } from './extractVideoImage'

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

// A minimal JPEG: two SOI/EOI sentinels. The production code never decodes it —
// it only reads back whatever ffmpeg wrote — so the exact bytes only have to be
// distinguishable, not a valid image.
const FRAME_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])

type ExecFileCallback = (
  error: ExecException | null,
  stdout: string,
  stderr: string
) => void

// `promisify(execFile)` is called at module load, so the mock replaces the raw
// `execFile` and is driven through the standard callback contract. Each test
// decides what ffmpeg "writes" to the output path the production code passes.
const mockFfmpeg = (run: (outputPath: string) => Promise<void> | void) => {
  vi.mocked(execFile).mockImplementation(((
    _file: string,
    args: readonly string[],
    _options: unknown,
    callback: ExecFileCallback
  ) => {
    const outputPath = args[args.length - 1]
    Promise.resolve()
      .then(() => run(outputPath))
      .then(
        () => callback(null, '', ''),
        (error: unknown) => callback(error as ExecException, '', '')
      )
    return {} as unknown as ChildProcess
  }) as unknown as typeof execFile)
}

const onlyOutputPath = () => {
  const call = vi.mocked(execFile).mock.calls[0]
  const outputPath = call?.[1]?.at(-1)
  if (typeof outputPath !== 'string') {
    throw new Error('ffmpeg output path was not passed')
  }
  return outputPath
}

describe('extractVideoImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks ffmpeg for the representative thumbnail frame with a single overwritten output', async () => {
    mockFfmpeg(async (outputPath) => {
      await fs.writeFile(outputPath, FRAME_BYTES)
    })

    await extractVideoImage('/tmp/clip.mp4')

    expect(execFile).toHaveBeenCalledTimes(1)
    const [command, args, options] = vi.mocked(execFile).mock.calls[0]
    expect(command).toBe('ffmpeg')
    expect(args).toEqual([
      '-loglevel',
      'error',
      '-threads',
      '2',
      '-i',
      path.resolve('/tmp/clip.mp4'),
      '-vf',
      "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,thumbnail=n=50",
      '-frames:v',
      '1',
      '-update',
      '1',
      '-y',
      expect.stringMatching(/^.+\.jpg$/)
    ])
    expect(options).toEqual({ timeout: 30_000 })
  })

  // Regression (F000): `thumbnail` keeps its whole batch of decoded frames in
  // memory. Unscaled, at its default batch of 100, a short 4K clip peaked at
  // ~1.6 GB resident; scaled first into a 1280px box with a batch of 50, ~245
  // MB. The scale must come BEFORE the thumbnail stage for that to hold.
  it('scales frames down before the thumbnail filter batches them', async () => {
    mockFfmpeg(async (outputPath) => {
      await fs.writeFile(outputPath, FRAME_BYTES)
    })

    await extractVideoImage('/tmp/clip.mp4')

    const args = vi.mocked(execFile).mock.calls[0][1] as string[]
    const filter = args[args.indexOf('-vf') + 1]
    expect(filter.startsWith('scale=')).toBe(true)
    expect(filter).toMatch(/,thumbnail=n=\d+$/)
  })

  it('returns the frame ffmpeg wrote', async () => {
    mockFfmpeg(async (outputPath) => {
      await fs.writeFile(outputPath, FRAME_BYTES)
    })

    await expect(extractVideoImage('/tmp/clip.mp4')).resolves.toEqual(
      FRAME_BYTES
    )
  })

  it('uses a random JPEG path inside the OS temp directory', async () => {
    mockFfmpeg(async (outputPath) => {
      await fs.writeFile(outputPath, FRAME_BYTES)
    })

    await extractVideoImage('/tmp/clip.mp4')

    const outputPath = onlyOutputPath()
    expect(path.dirname(outputPath)).toBe(tmpdir())
    expect(path.basename(outputPath)).toMatch(/^[0-9a-f]{16}\.jpg$/)
  })

  it('removes the temp frame after reading it', async () => {
    mockFfmpeg(async (outputPath) => {
      await fs.writeFile(outputPath, FRAME_BYTES)
    })

    await extractVideoImage('/tmp/clip.mp4')

    await expect(fs.access(onlyOutputPath())).rejects.toThrow()
  })

  // A clip ffmpeg cannot decode rejects, and the temp path it may already have
  // created has to go with it — otherwise every failed extraction leaks a file
  // for the lifetime of the container.
  it('rejects and removes the temp frame when ffmpeg fails', async () => {
    mockFfmpeg(async (outputPath) => {
      await fs.writeFile(outputPath, FRAME_BYTES)
      throw new Error('ffmpeg failed')
    })

    await expect(extractVideoImage('/tmp/clip.mp4')).rejects.toThrow(
      'ffmpeg failed'
    )

    await expect(fs.access(onlyOutputPath())).rejects.toThrow()
  })
})
