import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
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
  id: '7',
  type: 'image',
  mime_type: 'image/png',
  url: 'https://llun.test/api/v1/files/medias/sample.webp',
  preview_url: 'https://llun.test/api/v1/files/medias/sample.webp',
  text_url: null,
  remote_url: null,
  meta: { original: { width: 1, height: 1, size: '1x1', aspect: 1 } },
  description: '',
  blurhash: null
}

const buildForm = () => {
  const form = new FormData()
  form.set(
    'file',
    new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' })
  )
  return form
}

const postRequest = (token?: string) => {
  const req = new NextRequest('https://llun.test/api/v1/media', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  // jest / undici cannot materialise a multipart body from a FormData passed to
  // NextRequest — mock formData() directly (see update_credentials route test).
  Object.defineProperty(req, 'formData', {
    value: vi.fn().mockResolvedValue(buildForm())
  })
  return req
}

describe('POST /api/v1/media', () => {
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
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue(null)
    mockSaveMedia.mockResolvedValue(sampleAttachment)
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

  it('returns 200 with a fully-processed attachment for write:media tokens', async () => {
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
    expect(data).toMatchObject({ id: '7', type: 'image', blurhash: null })
    expect(mockSaveMedia).toHaveBeenCalledTimes(1)
  })
})
