import { NextRequest } from 'next/server'

import {
  TranslationProviderError,
  UnsupportedTargetLanguageError
} from '@/lib/services/translation/types'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockGetStatus = vi.fn()
const mockDatabase = { getStatus: mockGetStatus }
const mockCurrentActor = { id: 'https://local.test/users/me' }

const mockGetTranslationProvider = vi.fn()
const mockTranslateStatus = vi.fn()
const mockCanActorReadStatus = vi.fn()
const mockFetchEphemeralRemoteStatus = vi.fn()
const mockGetMastodonStatus = vi.fn()

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
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

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ languages: ['en'] })
}))

vi.mock('@/lib/services/translation', () => ({
  getTranslationProvider: () => mockGetTranslationProvider()
}))

vi.mock('@/lib/services/translation/translateStatus', () => ({
  translateStatus: (...args: unknown[]) => mockTranslateStatus(...args)
}))

vi.mock('@/lib/services/statusAccess', () => ({
  canActorReadStatus: (...args: unknown[]) => mockCanActorReadStatus(...args)
}))

vi.mock('@/lib/services/statuses/fetchEphemeralRemoteStatus', () => ({
  fetchEphemeralRemoteStatus: (...args: unknown[]) =>
    mockFetchEphemeralRemoteStatus(...args)
}))

vi.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatus: (...args: unknown[]) => mockGetMastodonStatus(...args)
}))

const statusId = 'https://local.test/users/alice/statuses/1'
const encodedId = urlToId(statusId)

// The id the remote profile page sends for a live-outbox status.
const remoteStatusUrl =
  'https://toot.io/users/devstorm/statuses/117434164364383111'
const remoteEncodedId = 'toot.io:users:devstorm:statuses:117434164364383111'

const post = (
  body?: string,
  contentType = 'application/json',
  id = encodedId
) =>
  POST(
    new NextRequest(`https://local.test/api/v1/statuses/${id}/translate`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      ...(body !== undefined ? { body } : {})
    }),
    { params: Promise.resolve({ id }) }
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
    for (const mock of [
      mockGetStatus,
      mockGetTranslationProvider,
      mockTranslateStatus,
      mockCanActorReadStatus,
      mockFetchEphemeralRemoteStatus,
      mockGetMastodonStatus
    ]) {
      mock.mockReset()
    }
    mockGetTranslationProvider.mockReturnValue({})
    mockGetStatus.mockResolvedValue({ id: statusId })
    mockCanActorReadStatus.mockResolvedValue(true)
    mockFetchEphemeralRemoteStatus.mockResolvedValue(null)
    mockGetMastodonStatus.mockResolvedValue(publicStatus)
    mockTranslateStatus.mockResolvedValue(translation)
  })

  it('returns 404 when no backend is configured, before any lookup', async () => {
    mockGetTranslationProvider.mockReturnValue(null)
    expect((await post('{}')).status).toBe(404)
    expect(mockGetStatus).not.toHaveBeenCalled()
    expect(mockFetchEphemeralRemoteStatus).not.toHaveBeenCalled()
    expect(mockTranslateStatus).not.toHaveBeenCalled()
  })

  it('returns 404 for a stored status the viewer cannot read, without fetching it live', async () => {
    mockCanActorReadStatus.mockResolvedValue(false)
    expect((await post('{}')).status).toBe(404)
    expect(mockFetchEphemeralRemoteStatus).not.toHaveBeenCalled()
    expect(mockTranslateStatus).not.toHaveBeenCalled()
  })

  it('translates an unstored remote status fetched live', async () => {
    const remoteStatus = { id: remoteStatusUrl }
    mockGetStatus.mockResolvedValue(null)
    mockFetchEphemeralRemoteStatus.mockResolvedValue(remoteStatus)

    const response = await post(
      JSON.stringify({ lang: 'en' }),
      'application/json',
      remoteEncodedId
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(translation)
    expect(mockGetStatus).toHaveBeenCalledWith(
      expect.objectContaining({ statusId: remoteStatusUrl })
    )
    expect(mockFetchEphemeralRemoteStatus).toHaveBeenCalledWith({
      database: mockDatabase,
      statusId: remoteStatusUrl,
      currentActor: mockCurrentActor
    })
    expect(mockGetMastodonStatus).toHaveBeenCalledWith(
      mockDatabase,
      remoteStatus,
      mockCurrentActor.id
    )
  })

  it('returns 404 when an unstored status cannot be fetched live', async () => {
    mockGetStatus.mockResolvedValue(null)
    expect((await post('{}', 'application/json', remoteEncodedId)).status).toBe(
      404
    )
    expect(mockTranslateStatus).not.toHaveBeenCalled()
  })

  it('returns 403 for a live-fetched status that serializes as non-public', async () => {
    mockGetStatus.mockResolvedValue(null)
    mockFetchEphemeralRemoteStatus.mockResolvedValue({ id: remoteStatusUrl })
    mockGetMastodonStatus.mockResolvedValue({
      visibility: 'private',
      content: '<p>secret</p>'
    })
    expect((await post('{}', 'application/json', remoteEncodedId)).status).toBe(
      403
    )
    expect(mockTranslateStatus).not.toHaveBeenCalled()
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
