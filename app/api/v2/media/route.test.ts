import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { MediaValidationError } from '@/lib/services/medias/errors'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = vi.fn()
const mockStoredToken = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({
    where: () => ({
      first: () => mockStoredToken()
    })
  })
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const mockSaveMedia = vi.fn()
vi.mock('@/lib/services/medias', () => ({
  saveMedia: (...args: unknown[]) => mockSaveMedia(...args)
}))

const sampleAttachment = {
  id: '99',
  type: 'image',
  mime_type: 'image/png',
  url: 'https://llun.test/api/v1/files/medias/sample.webp',
  preview_url: 'https://llun.test/api/v1/files/medias/sample.webp',
  text_url: null,
  remote_url: null,
  meta: { original: { width: 1, height: 1, size: '1x1', aspect: 1 } },
  description: 'alt text',
  blurhash: null
}

const buildForm = () => {
  const form = new FormData()
  form.set(
    'file',
    new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' })
  )
  form.set('description', 'alt text')
  form.set('focus', '0.1,-0.2')
  return form
}

const postRequest = (token?: string, form?: FormData) => {
  const req = new NextRequest('https://llun.test/api/v2/media', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  // jest / undici cannot materialise a multipart body from a FormData passed to
  // NextRequest — mock formData() directly (see update_credentials route test).
  Object.defineProperty(req, 'formData', {
    value: vi.fn().mockResolvedValue(form ?? buildForm())
  })
  return req
}

describe('POST /api/v2/media', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue(null)
    mockSaveMedia.mockResolvedValue(sampleAttachment)
    await database.deleteServerSetting({ key: 'media.maxFileSize' })
    invalidateServerSettingsCache(database)
  })

  it('requires a bearer token (401 when unauthenticated)', async () => {
    const response = await POST(postRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('rejects a token that lacks write:media (401)', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'read'
    })

    const response = await POST(postRequest('read-only-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('accepts a write:media token and returns 200 with the attachment', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write:media'
    })

    const response = await POST(postRequest('write-media-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ id: '99', type: 'image', blurhash: null })

    // The parsed focus/description are forwarded to saveMedia.
    const media = mockSaveMedia.mock.calls[0][2]
    expect(media.description).toBe('alt text')
    expect(media.focus).toEqual({ x: 0.1, y: -0.2 })
  })

  it('accepts the coarser write scope', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write'
    })

    const response = await POST(postRequest('write-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
  })

  it('returns 422 when the uploaded file is invalid', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write:media'
    })

    const form = new FormData()
    form.set(
      'file',
      new File([new Uint8Array([1])], 'bad.txt', { type: 'text/plain' })
    )

    const response = await POST(postRequest('write-media-token', form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  // The upload cap is the resolved `media.maxFileSize` server setting. It used
  // to be a synchronous FileSchema refine reading getConfig(), so a cap set only
  // in the admin UI (no env var) was never enforced. The sample upload is 3
  // bytes.
  it.each([
    {
      description: 'rejects a file over the admin-configured media.maxFileSize',
      maxFileSize: 2,
      expectedStatus: 422,
      expectedSaveCalls: 0
    },
    {
      description:
        'accepts a file within the admin-configured media.maxFileSize',
      maxFileSize: 3,
      expectedStatus: 200,
      expectedSaveCalls: 1
    }
  ])(
    '$description',
    async ({ maxFileSize, expectedStatus, expectedSaveCalls }) => {
      mockStoredToken.mockResolvedValue({
        expiresAt: new Date(Date.now() + 60_000),
        referenceId: ACTOR1_ID,
        scopes: 'write:media'
      })
      await database.setServerSettings([
        { key: 'media.maxFileSize', value: maxFileSize }
      ])
      invalidateServerSettingsCache(database)

      const response = await POST(postRequest('write-media-token'), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(expectedStatus)
      expect(mockSaveMedia).toHaveBeenCalledTimes(expectedSaveCalls)
    }
  )

  it('returns 422 when the thumbnail exceeds the admin-configured media.maxFileSize', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write:media'
    })
    await database.setServerSettings([{ key: 'media.maxFileSize', value: 3 }])
    invalidateServerSettingsCache(database)

    const form = buildForm()
    form.set(
      'thumbnail',
      new File([new Uint8Array([1, 2, 3, 4])], 'thumb.png', {
        type: 'image/png'
      })
    )

    const response = await POST(postRequest('write-media-token', form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('returns 422 for a malformed multipart body', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write:media'
    })

    const req = new NextRequest('https://llun.test/api/v2/media', {
      method: 'POST',
      headers: { Authorization: 'Bearer write-media-token' }
    })
    // A malformed multipart body makes formData() throw — a client error (422),
    // not an internal failure (500).
    Object.defineProperty(req, 'formData', {
      value: vi.fn().mockRejectedValue(new Error('Could not parse content'))
    })

    const response = await POST(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(422)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('returns 422 for client-actionable upload failures (quota / invalid media)', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write:media'
    })
    mockSaveMedia.mockRejectedValue(
      new MediaValidationError('Storage quota exceeded')
    )

    const response = await POST(postRequest('write-media-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
  })

  it('returns 500 when saving throws an unexpected internal error', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write:media'
    })
    mockSaveMedia.mockRejectedValue(new Error('storage unavailable'))

    const response = await POST(postRequest('write-media-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(500)
  })
})
