import { NextRequest } from 'next/server'

import { PresignedUploadValidationError } from '@/lib/services/medias'

import { PATCH } from './route'

const mockCompletePresignedMediaUpload = vi.fn()
const mockCurrentActor = {
  id: 'https://llun.test/users/llun',
  account: { id: 'account-1' }
}
const mockDatabase = {}

vi.mock('@/lib/services/medias', () => ({
  completePresignedMediaUpload: (...params: unknown[]) =>
    mockCompletePresignedMediaUpload(...params),
  getPresignedUrl: vi.fn(),
  PresignedUploadValidationError: class PresignedUploadValidationError extends Error {}
}))

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor
      })
}))

describe('PATCH /api/v1/medias/presigned', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = (body: string) =>
    new NextRequest('https://llun.test/api/v1/medias/presigned', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body
    })

  it('returns 422 for invalid completion input', async () => {
    const response = await PATCH(createRequest(JSON.stringify({})), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
    expect(mockCompletePresignedMediaUpload).not.toHaveBeenCalled()
  })

  it('returns 500 for unexpected completion failures', async () => {
    mockCompletePresignedMediaUpload.mockRejectedValueOnce(
      new Error('storage unavailable')
    )

    const response = await PATCH(
      createRequest(JSON.stringify({ mediaId: 'media-1' })),
      {
        params: Promise.resolve({})
      }
    )

    expect(response.status).toBe(500)
    expect(mockCompletePresignedMediaUpload).toHaveBeenCalledWith(
      mockDatabase,
      mockCurrentActor,
      'media-1'
    )
  })

  it('returns 422 for presigned upload verification failures', async () => {
    mockCompletePresignedMediaUpload.mockRejectedValueOnce(
      new PresignedUploadValidationError(
        'Uploaded object does not match expected checksum'
      )
    )

    const response = await PATCH(
      createRequest(JSON.stringify({ mediaId: 'media-1' })),
      {
        params: Promise.resolve({})
      }
    )

    expect(response.status).toBe(422)
    expect(mockCompletePresignedMediaUpload).toHaveBeenCalledWith(
      mockDatabase,
      mockCurrentActor,
      'media-1'
    )
  })
})
