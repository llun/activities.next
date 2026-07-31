import { NextRequest } from 'next/server'

import { getMedia } from '@/lib/services/medias'

import { GET } from './route'

const mockDatabase = { id: 'test-database' }

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/services/medias', () => ({
  getMedia: vi.fn()
}))

describe('GET /api/v1/files/[...pathname]', () => {
  const mockGetMedia = getMedia as jest.MockedFunction<typeof getMedia>

  beforeEach(() => {
    mockGetMedia.mockReset()
  })

  const getFile = (pathname: string[]) =>
    GET(new NextRequest('https://llun.test/api/v1/files/test.png'), {
      params: Promise.resolve({ pathname })
    })

  it('rejects absolute POSIX paths before media lookup', async () => {
    const response = await getFile(['/etc/passwd'])

    expect(response.status).toBe(404)
    expect(mockGetMedia).not.toHaveBeenCalled()
  })

  it('rejects Windows drive-prefixed paths before media lookup', async () => {
    const response = await getFile([
      'C:\\Windows\\System32\\drivers\\etc\\hosts'
    ])

    expect(response.status).toBe(404)
    expect(mockGetMedia).not.toHaveBeenCalled()
  })

  it('normalizes mixed-slash traversal before media lookup', async () => {
    mockGetMedia.mockResolvedValue({
      type: 'buffer',
      buffer: Buffer.from('image-data'),
      contentType: 'image/png'
    })

    const response = await getFile(['safe', '..', '..\\secret.png'])

    expect(response.status).toBe(200)
    expect(mockGetMedia).toHaveBeenCalledWith(mockDatabase, 'secret.png')
  })

  describe('reserved fitness paths', () => {
    // Fitness uploads land under the media root by default — S3/object storage
    // under a `fitness/` key prefix in the same bucket, local storage in a
    // `fitness` directory under ACTIVITIES_MEDIA_STORAGE_PATH. This route has no
    // access control and redirects to the public CDN hostname when one is set,
    // so without the guard it serves the bytes that
    // `GET /api/v1/fitness-files/:id` now restricts to their owner.
    it.each([
      {
        description: 'refuses a fitness object path',
        pathname: ['fitness', '2026-07-30', 'a1b2c3d4e5f60718.fit']
      },
      {
        description: 'refuses the bare fitness segment',
        pathname: ['fitness']
      },
      {
        description: 'refuses a differently-cased fitness segment',
        pathname: ['Fitness', '2026-07-30', 'a1b2c3d4e5f60718.gpx']
      },
      {
        description: 'refuses a fitness path reached by traversal',
        pathname: ['medias', '..', 'fitness', 'a1b2c3d4e5f60718.tcx']
      }
    ])('$description', async ({ pathname }: { pathname: string[] }) => {
      const response = await getFile(pathname)

      expect(response.status).toBe(404)
      expect(mockGetMedia).not.toHaveBeenCalled()
    })

    // The object-storage deployment redirects to the public CDN hostname, and
    // the URL parser that builds that `Location` can normalise a path the
    // request did not carry — so the redirect is re-checked on the way out.
    //
    // NEITHER check subsumes the other; they overlap, which is exactly why both
    // are here. Next decodes a catch-all segment once, so `%3F` arrives as a
    // literal `?`: the request path `fitness?x/y.gpx` does not start with
    // `fitness/` and passes the first check, while `new URL()` splits the query
    // off and leaves a pathname of `/fitness`, which the second refuses. It runs
    // the other way too — `medias?/../fitness/y.gpx` is caught on the way in and
    // would not be on the way out, because the parser stops the pathname at the
    // `?` before the `..` can resolve.
    describe('redirect responses', () => {
      it('refuses a redirect that resolves into fitness storage', async () => {
        mockGetMedia.mockResolvedValue({
          type: 'redirect',
          redirectUrl:
            'https://cdn.example.test/medias/%2e%2e/fitness/a1b2c3d4e5f60718.gpx'
        })

        const response = await getFile(['medias', 'x.webp'])

        expect(response.status).toBe(404)
      })

      // The concrete case the first check cannot see: a literal `?` in a
      // segment (Next decodes `%3F` once) keeps the request path off the
      // `fitness/` prefix, and only the parsed `Location` reveals it.
      it('refuses a redirect whose query hides the reserved prefix', async () => {
        mockGetMedia.mockResolvedValue({
          type: 'redirect',
          redirectUrl: 'https://cdn.example.test/fitness?x/y.gpx'
        })

        const response = await getFile(['fitness?x', 'y.gpx'])

        expect(response.status).toBe(404)
        // Proof this is egress-only: the first check let it through, so the
        // lookup actually happened.
        expect(mockGetMedia).toHaveBeenCalled()
      })

      it('refuses a redirect whose URL cannot be parsed', async () => {
        mockGetMedia.mockResolvedValue({
          type: 'redirect',
          redirectUrl: 'not-a-url'
        })

        const response = await getFile(['medias', 'x.webp'])

        expect(response.status).toBe(404)
      })

      it('still redirects an ordinary media object', async () => {
        mockGetMedia.mockResolvedValue({
          type: 'redirect',
          redirectUrl:
            'https://cdn.example.test/medias/2026-07-30/a1b2c3d4e5f60718.webp'
        })

        const response = await getFile([
          'medias',
          '2026-07-30',
          'a1b2c3d4e5f60718.webp'
        ])

        expect(response.status).toBe(308)
        expect(response.headers.get('location')).toBe(
          'https://cdn.example.test/medias/2026-07-30/a1b2c3d4e5f60718.webp'
        )
      })
    })

    it.each([
      {
        description: 'still serves an ordinary media object',
        pathname: ['medias', '2026-07-30', 'a1b2c3d4e5f60718.webp'],
        expectedPath: 'medias/2026-07-30/a1b2c3d4e5f60718.webp'
      },
      {
        description: 'matches on a segment boundary, not a prefix string',
        // `fitnessed` starts with `fitness` but is a different directory.
        pathname: ['fitnessed', 'a1b2c3d4e5f60718.webp'],
        expectedPath: 'fitnessed/a1b2c3d4e5f60718.webp'
      }
    ])(
      '$description',
      async ({
        pathname,
        expectedPath
      }: {
        pathname: string[]
        expectedPath: string
      }) => {
        mockGetMedia.mockResolvedValue({
          type: 'buffer',
          buffer: Buffer.from('image-data'),
          contentType: 'image/webp'
        })

        const response = await getFile(pathname)

        expect(response.status).toBe(200)
        expect(mockGetMedia).toHaveBeenCalledWith(mockDatabase, expectedPath)
      }
    )
  })
})
