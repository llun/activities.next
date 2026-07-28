import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { extractVideoImage } from '@/lib/services/medias/extractVideoImage'

import { extractVideoPreviewFrame } from './videoPreview'

vi.mock('@/lib/services/medias/extractVideoImage', () => ({
  extractVideoImage: vi.fn()
}))

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('extractVideoPreviewFrame', () => {
  // What the temp file held when the extraction was handed its path.
  let extractedFrom: Buffer | null

  beforeEach(() => {
    vi.clearAllMocks()
    extractedFrom = null
    vi.mocked(extractVideoImage).mockImplementation(async (filePath) => {
      extractedFrom = await fs.readFile(filePath)
      return ONE_PIXEL_PNG
    })
  })

  const tempPath = () => vi.mocked(extractVideoImage).mock.calls[0][0]

  it('extracts the frame from a temp copy of the video', async () => {
    const buffer = Buffer.from('video-bytes')

    await expect(extractVideoPreviewFrame(buffer, '.mp4')).resolves.toEqual(
      ONE_PIXEL_PNG
    )

    expect(extractVideoImage).toHaveBeenCalledTimes(1)
    expect(extractedFrom).toEqual(buffer)
  })

  it('removes the temp copy once the frame is extracted', async () => {
    await extractVideoPreviewFrame(Buffer.from('video-bytes'), '.mp4')

    await expect(fs.access(tempPath())).rejects.toThrow()
  })

  // Otherwise a decode failure leaks the copy for the lifetime of the
  // container, and every failed upload leaves one behind.
  it('removes the temp copy when the extraction fails', async () => {
    vi.mocked(extractVideoImage).mockRejectedValue(new Error('ffmpeg failed'))

    await expect(
      extractVideoPreviewFrame(Buffer.from('video-bytes'), '.mp4')
    ).rejects.toThrow('ffmpeg failed')

    await expect(fs.access(tempPath())).rejects.toThrow()
  })

  // The name is server-derived, so nothing a client sends can steer either the
  // directory or the demuxer ffmpeg picks for the path.
  it.each([
    {
      description: 'names the temp copy from the extension',
      extension: '.mp4'
    },
    { description: 'keeps webm under its own extension', extension: '.webm' }
  ])('$description', async ({ extension }) => {
    await extractVideoPreviewFrame(Buffer.from('video-bytes'), extension)

    const filePath = tempPath()
    expect(path.resolve(path.dirname(filePath))).toBe(path.resolve(os.tmpdir()))
    expect(path.basename(filePath)).toMatch(
      new RegExp(`^[0-9a-f]{16}-video\\${extension}$`)
    )
  })

  // `wx` (O_EXCL): the write must fail rather than follow a symlink planted at
  // the path or clobber a file already there.
  it('refuses to write over an existing temp path', async () => {
    const collision = path.join(os.tmpdir(), 'existing-video.mp4')
    await fs.writeFile(collision, 'someone-elses-bytes')
    const spy = vi.spyOn(fs, 'writeFile')

    try {
      // The random prefix makes a real collision infeasible to aim at, so the
      // path has to be forced to prove the flag is the thing preventing it.
      spy.mockImplementationOnce((_target, data, options) =>
        fs.writeFile(collision, data as Buffer, options as object)
      )

      await expect(
        extractVideoPreviewFrame(Buffer.from('video-bytes'), '.mp4')
      ).rejects.toMatchObject({ code: 'EEXIST' })

      expect(extractVideoImage).not.toHaveBeenCalled()
      await expect(fs.readFile(collision, 'utf-8')).resolves.toBe(
        'someone-elses-bytes'
      )
    } finally {
      spy.mockRestore()
      await fs.unlink(collision).catch(() => undefined)
    }
  })
})
