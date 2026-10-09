import sharp from 'sharp'

import { getMedia } from '@/lib/services/medias'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'

vi.mock('@/lib/services/medias', () => ({ getMedia: vi.fn() }))
vi.mock('@/lib/utils/safeImageDownload', () => ({ safeImageFetch: vi.fn() }))

const database = {} as never

const streamOf = (bytes: Buffer) =>
  new Response(new Uint8Array(bytes)).body as ReadableStream

describe('readStoredImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeImage = (format: 'jpeg' | 'png' | 'webp') => {
    const image = sharp({
      create: { width: 4, height: 4, channels: 3, background: '#fff' }
    })
    return image[format]().toBuffer()
  }

  it.each(['jpeg', 'png', 'webp'] as const)(
    'reads a streamed %s and labels it by its bytes',
    async (format) => {
      const image = await makeImage(format)
      vi.mocked(getMedia).mockResolvedValue({
        type: 'stream',
        stream: streamOf(image),
        contentType: 'application/octet-stream',
        contentLength: image.length
      })

      const result = await readStoredImage(database, 'medias/a')

      expect(result?.buffer.equals(image)).toBeTrue()
      expect(result?.mimeType).toBe(`image/${format}`)
      expect(getMedia).toHaveBeenCalledWith(database, 'medias/a')
    }
  )

  it('follows a storage redirect through the guarded binary fetch', async () => {
    const image = await makeImage('webp')
    vi.mocked(getMedia).mockResolvedValue({
      type: 'redirect',
      redirectUrl: 'https://cdn.test/medias/a'
    })
    vi.mocked(safeImageFetch).mockResolvedValue(
      new Response(new Uint8Array(image), {
        headers: { 'content-length': String(image.length) }
      })
    )

    const result = await readStoredImage(database, 'medias/a')

    expect(result?.mimeType).toBe('image/webp')
    expect(safeImageFetch).toHaveBeenCalledWith(
      'https://cdn.test/medias/a',
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it.each([
    ['the path is unknown', () => vi.mocked(getMedia).mockResolvedValue(null)],
    [
      'the redirect cannot be fetched',
      () => {
        vi.mocked(getMedia).mockResolvedValue({
          type: 'redirect',
          redirectUrl: 'https://cdn.test/x'
        })
        vi.mocked(safeImageFetch).mockResolvedValue(null)
      }
    ],
    [
      'the redirect answers an error',
      () => {
        vi.mocked(getMedia).mockResolvedValue({
          type: 'redirect',
          redirectUrl: 'https://cdn.test/x'
        })
        vi.mocked(safeImageFetch).mockResolvedValue(
          new Response('nope', { status: 404 })
        )
      }
    ]
  ])('returns null when %s', async (_, arrange) => {
    arrange()

    expect(await readStoredImage(database, 'medias/a')).toBeNull()
  })

  it('refuses a stream over the byte cap', async () => {
    vi.mocked(getMedia).mockResolvedValue({
      type: 'stream',
      stream: streamOf(Buffer.alloc(64)),
      contentType: 'image/jpeg',
      contentLength: 64
    })

    await expect(readStoredImage(database, 'medias/a', 16)).rejects.toThrow()
  })
})
