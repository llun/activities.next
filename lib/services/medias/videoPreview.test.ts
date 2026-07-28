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

  // `wx` (O_EXCL): the open must fail rather than follow a symlink planted at
  // the path or clobber a file already there — and the file it refused to
  // clobber must survive, since a collision is the one case where the path is
  // not this call's to remove.
  it('refuses to write over an existing temp path', async () => {
    const scratchDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'video-preview-')
    )
    const collision = path.join(scratchDir, 'existing-video.mp4')
    const spy = vi.spyOn(fs, 'open')

    try {
      await fs.writeFile(collision, 'someone-elses-bytes')
      // The random prefix makes a real collision infeasible to aim at, so the
      // path has to be forced to prove the flag is the thing preventing it.
      spy.mockImplementationOnce((_target, flags) => fs.open(collision, flags))

      await expect(
        extractVideoPreviewFrame(Buffer.from('video-bytes'), '.mp4')
      ).rejects.toMatchObject({ code: 'EEXIST' })

      expect(extractVideoImage).not.toHaveBeenCalled()
      await expect(fs.readFile(collision, 'utf-8')).resolves.toBe(
        'someone-elses-bytes'
      )
    } finally {
      spy.mockRestore()
      await fs.rm(scratchDir, { recursive: true, force: true })
    }
  })

  // The file exists from the moment it is opened, and a write that fails after
  // that leaves a partial copy: an ENOSPC partway through a 200MB upload used
  // to leak one per attempt for the lifetime of the container.
  it('removes the temp copy when the write fails partway', async () => {
    const spy = vi.spyOn(fs, 'open')
    let openedPath: string | null = null

    try {
      spy.mockImplementationOnce(async (target, flags) => {
        openedPath = String(target)
        const handle = await fs.open(target, flags)
        handle.writeFile = async () => {
          throw Object.assign(new Error('no space left on device'), {
            code: 'ENOSPC'
          })
        }
        return handle
      })

      await expect(
        extractVideoPreviewFrame(Buffer.from('video-bytes'), '.mp4')
      ).rejects.toThrow('no space left on device')

      expect(extractVideoImage).not.toHaveBeenCalled()
      await expect(fs.access(openedPath!)).rejects.toThrow()
    } finally {
      spy.mockRestore()
    }
  })
})
