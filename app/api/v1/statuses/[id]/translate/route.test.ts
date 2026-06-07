import { NextRequest } from 'next/server'

import {
  TranslationProviderError,
  UnsupportedTargetLanguageError
} from '@/lib/services/translation/types'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockDatabase = {}
const mockCurrentActor = { id: 'https://local.test/users/me' }

const mockGetTranslationProvider = jest.fn()
const mockTranslateStatus = jest.fn()
const mockGetReadableStatus = jest.fn()
const mockGetMastodonStatus = jest.fn()

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

jest.mock('@/lib/config', () => ({
  getConfig: () => ({ languages: ['en'] })
}))

jest.mock('@/lib/services/translation', () => ({
  getTranslationProvider: () => mockGetTranslationProvider()
}))

jest.mock('@/lib/services/translation/translateStatus', () => ({
  translateStatus: (...args: unknown[]) => mockTranslateStatus(...args)
}))

jest.mock('@/lib/services/statusRouteAccess', () => ({
  getReadableStatus: (...args: unknown[]) => mockGetReadableStatus(...args)
}))

jest.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatus: (...args: unknown[]) => mockGetMastodonStatus(...args)
}))

const statusId = 'https://local.test/users/alice/statuses/1'
const encodedId = urlToId(statusId)

const post = (body?: string, contentType = 'application/json') =>
  POST(
    new NextRequest(
      `https://local.test/api/v1/statuses/${encodedId}/translate`,
      {
        method: 'POST',
        headers: { 'content-type': contentType },
        ...(body !== undefined ? { body } : {})
      }
    ),
    { params: Promise.resolve({ id: encodedId }) }
  )

const publicStatus = { visibility: 'public', content: '<p>hola</p>' }
const translation = {
  content: '<p>hello</p>',
  spoiler_text: '',
  language: 'en',
  media_attachments: [],
  poll: null,
  detected_source_language: 'es',
  provider: 'DeepL.com'
}

describe('POST /api/v1/statuses/:id/translate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetTranslationProvider.mockReturnValue({})
    mockGetReadableStatus.mockResolvedValue({ id: statusId })
    mockGetMastodonStatus.mockResolvedValue(publicStatus)
    mockTranslateStatus.mockResolvedValue(translation)
  })

  it('returns 404 when no backend is configured', async () => {
    mockGetTranslationProvider.mockReturnValue(null)
    expect((await post('{}')).status).toBe(404)
    expect(mockTranslateStatus).not.toHaveBeenCalled()
  })

  it('returns 404 when the status is not readable', async () => {
    mockGetReadableStatus.mockResolvedValue(null)
    expect((await post('{}')).status).toBe(404)
  })

  it('returns 403 for a non-public status', async () => {
    mockGetMastodonStatus.mockResolvedValue({
      visibility: 'private',
      content: '<p>secret</p>'
    })
    expect((await post('{}')).status).toBe(403)
    expect(mockTranslateStatus).not.toHaveBeenCalled()
  })

  it('returns 422 for a malformed body', async () => {
    expect((await post('{not json')).status).toBe(422)
    expect(mockTranslateStatus).not.toHaveBeenCalled()
  })

  it('returns 403 for an unsupported target language', async () => {
    mockTranslateStatus.mockRejectedValue(
      new UnsupportedTargetLanguageError('jp')
    )
    expect((await post('{}')).status).toBe(403)
  })

  it('returns 503 when the backend fails', async () => {
    mockTranslateStatus.mockRejectedValue(new TranslationProviderError('down'))
    expect((await post('{}')).status).toBe(503)
  })

  it('re-throws unexpected errors so they surface as a traced 500', async () => {
    mockTranslateStatus.mockRejectedValue(new TypeError('bug'))
    await expect(post('{}')).rejects.toThrow('bug')
  })

  it('returns 200 with the Translation entity on success', async () => {
    const response = await post(JSON.stringify({ lang: 'en' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(translation)
  })

  it('falls back to the server default language when lang is omitted', async () => {
    await post('{}')
    expect(mockTranslateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ targetLanguage: 'en' })
    )
  })
})
