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
  deleteMediaWithFiles: vi.fn()
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
    mockDatabase.deleteMediaWithFiles.mockResolvedValue({
      status: 'deleted',
      files: ['uploads/original.jpg', 'uploads/thumbnail.jpg']
    })
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

  it('returns 500 when database deletion fails, deleting no file', async () => {
    mockDatabase.deleteMediaWithFiles.mockResolvedValue({
      status: 'not-found'
    })

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
    expect(mockDatabase.deleteMediaWithFiles).toHaveBeenCalledWith({
      mediaId: 'media-123'
    })
    expect(mockDeleteMediaFile).not.toHaveBeenCalled()
  })

  it('deletes the storage files and returns 200 on success', async () => {
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
    expect(mockDatabase.deleteMediaWithFiles).toHaveBeenCalledWith({
      mediaId: 'media-123'
    })
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('mediaId', 'media-123')
    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      'accountId',
      expect.anything()
    )
  })

  // The paths are the ones the delete read under the media row's lock, so a
  // photo edit saved between the ownership check and the delete is included.
  it('deletes exactly the files the delete reports, after the row is gone', async () => {
    mockDatabase.deleteMediaWithFiles.mockResolvedValue({
      status: 'deleted',
      files: [
        'uploads/render.webp',
        'uploads/client.jpg',
        'uploads/edit-original.jpg',
        'uploads/superseded.webp'
      ]
    })

    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/media/media-123',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ mediaId: 'media-123' })
    })

    expect(res.status).toBe(200)
    const deleted = mockDeleteMediaFile.mock.calls.map((call) => call[1])
    expect(deleted).toEqual([
      'uploads/render.webp',
      'uploads/client.jpg',
      'uploads/edit-original.jpg',
      'uploads/superseded.webp'
    ])
    expect(
      mockDatabase.deleteMediaWithFiles.mock.invocationCallOrder[0]
    ).toBeLessThan(mockDeleteMediaFile.mock.invocationCallOrder[0])
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
    expect(mockDatabase.deleteMediaWithFiles).toHaveBeenCalledWith({
      mediaId: 'media-123'
    })
  })
})
