import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = jest.fn()
const mockStoredToken = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({
    where: () => ({
      first: () => mockStoredToken()
    })
  })
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const mockSaveMedia = jest.fn()
jest.mock('@/lib/services/medias', () => ({
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
    value: jest.fn().mockResolvedValue(form ?? buildForm())
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

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue(null)
    mockSaveMedia.mockResolvedValue(sampleAttachment)
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
})
