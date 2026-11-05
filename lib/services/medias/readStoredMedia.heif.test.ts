import { getMedia } from '@/lib/services/medias'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'

const { mockMetadata } = vi.hoisted(() => ({ mockMetadata: vi.fn() }))

// Only the sniff runs sharp here, and an HEVC HEIF cannot be produced by the
// bundled libvips, so the metadata answer is the input.
vi.mock('sharp', () => ({
  default: () => ({ metadata: mockMetadata })
}))
vi.mock('@/lib/services/medias', () => ({ getMedia: vi.fn() }))

const database = {} as never

const read = async () => {
  const bytes = Buffer.from('heif-bytes')
  vi.mocked(getMedia).mockResolvedValue({
    type: 'stream',
    stream: new Response(new Uint8Array(bytes)).body as ReadableStream,
    contentType: 'application/octet-stream',
    contentLength: bytes.length
  })
  return readStoredImage(database, 'medias/a')
}

describe('readStoredImage HEIF sniffing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not label an HEVC HEIF as AVIF', async () => {
    mockMetadata.mockResolvedValue({ format: 'heif', compression: 'hevc' })

    await expect(read()).resolves.toMatchObject({
      mimeType: 'application/octet-stream'
    })
  })

  it('labels an AV1 HEIF as AVIF', async () => {
    mockMetadata.mockResolvedValue({ format: 'heif', compression: 'av1' })

    await expect(read()).resolves.toMatchObject({ mimeType: 'image/avif' })
  })
})
