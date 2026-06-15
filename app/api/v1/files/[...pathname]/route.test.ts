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
})
