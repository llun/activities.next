import { NextRequest } from 'next/server'

import { deleteMediaFile } from '@/lib/services/medias'
import {
  ERROR_400,
  ERROR_401,
  ERROR_404,
  ERROR_500
} from '@/lib/utils/response'

import { DELETE, OPTIONS } from './route'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}))

const mockSpan = {
  setAttribute: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
  recordException: vi.fn()
}

vi.mock('@/lib/utils/trace', () => ({
  getTracer: () => ({
    startActiveSpan: (_name: string, fn: (span: typeof mockSpan) => unknown) =>
      fn(mockSpan)
  })
}))

const mockCurrentActor: {
  id: string
  account?: { id: string }
} = {
  id: 'https://llun.test/users/llun',
  account: { id: 'account-1' }
}

const mockDatabase = {
  getMediaByIdForAccount: vi.fn(),
  deleteMedia: vi.fn()
}

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (
      handler: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{ mediaId?: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ mediaId?: string }> }) =>
      handler(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

vi.mock('@/lib/services/medias', () => ({
  deleteMediaFile: vi.fn()
}))

const mockDeleteMediaFile = deleteMediaFile as jest.MockedFunction<
  typeof deleteMediaFile
>

describe('OPTIONS /api/v1/accounts/media/[mediaId]', () => {
  it('returns 200 with allowed CORS methods', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media/media-123',
      {
        method: 'OPTIONS',
        headers: { Origin: 'https://llun.test' }
      }
    )
    const res = await OPTIONS(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://llun.test'
    )
  })
})

describe('DELETE /api/v1/accounts/media/[mediaId]', () => {
  const sampleMedia = {
    id: 'media-123',
    actorId: 'https://llun.test/users/llun',
    original: {
      path: 'uploads/original.jpg',
      bytes: 1024,
      mimeType: 'image/jpeg'
    },
    thumbnail: {
      path: 'uploads/thumbnail.jpg',
      bytes: 256,
      mimeType: 'image/jpeg'
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentActor.account = { id: 'account-1' }
    mockDatabase.getMediaByIdForAccount.mockResolvedValue(sampleMedia)
    mockDatabase.deleteMedia.mockResolvedValue(true)
    mockDeleteMediaFile.mockResolvedValue(true)
  })

  it('returns 401 when actor has no account', async () => {
    mockCurrentActor.account = undefined

    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media/media-123',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ mediaId: 'media-123' })
    })

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json).toEqual(ERROR_401)
    expect(mockDatabase.getMediaByIdForAccount).not.toHaveBeenCalled()
  })

  it('returns 400 when mediaId is missing', async () => {
    const req = new NextRequest('https://llun.test/api/v1/accounts/media/', {
      method: 'DELETE'
    })
    const res = await DELETE(req, {
      params: Promise.resolve({ mediaId: '' })
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toEqual(ERROR_400)
    expect(mockDatabase.getMediaByIdForAccount).not.toHaveBeenCalled()
  })

  it('returns 404 when media is not found or not owned by account', async () => {
    mockDatabase.getMediaByIdForAccount.mockResolvedValue(null)

    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media/media-unknown',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ mediaId: 'media-unknown' })
    })

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json).toEqual(ERROR_404)
    expect(mockDatabase.getMediaByIdForAccount).toHaveBeenCalledWith({
      mediaId: 'media-unknown',
      accountId: 'account-1'
    })
    expect(mockDeleteMediaFile).not.toHaveBeenCalled()
  })

  it('returns 500 when database deletion fails', async () => {
    mockDatabase.deleteMedia.mockResolvedValue(false)

    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media/media-123',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ mediaId: 'media-123' })
    })

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).toEqual(ERROR_500)
    expect(mockDatabase.deleteMedia).toHaveBeenCalledWith({
      mediaId: 'media-123'
    })
  })

  it('deletes storage files (original and thumbnail) and returns 200 on success', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media/media-123',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ mediaId: 'media-123' })
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true })

    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      mockDatabase,
      'uploads/original.jpg'
    )
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      mockDatabase,
      'uploads/thumbnail.jpg'
    )
    expect(mockDatabase.deleteMedia).toHaveBeenCalledWith({
      mediaId: 'media-123'
    })
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('mediaId', 'media-123')
    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      'accountId',
      expect.anything()
    )
  })

  it('handles media without thumbnail', async () => {
    mockDatabase.getMediaByIdForAccount.mockResolvedValue({
      id: 'media-no-thumb',
      actorId: 'https://llun.test/users/llun',
      original: {
        path: 'uploads/no-thumb.png',
        bytes: 2048,
        mimeType: 'image/png'
      },
      thumbnail: null
    })

    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media/media-no-thumb',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ mediaId: 'media-no-thumb' })
    })

    expect(res.status).toBe(200)
    expect(mockDeleteMediaFile).toHaveBeenCalledTimes(1)
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      mockDatabase,
      'uploads/no-thumb.png'
    )
  })

  it('proceeds even if storage file deletion rejects or returns false', async () => {
    mockDeleteMediaFile.mockRejectedValue(new Error('Storage failure'))

    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media/media-123',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ mediaId: 'media-123' })
    })

    expect(res.status).toBe(200)
    expect(mockDatabase.deleteMedia).toHaveBeenCalledWith({
      mediaId: 'media-123'
    })
  })
})
