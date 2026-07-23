import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { FEDERATION_SIGNING_ACTOR_USERNAME } from '@/lib/services/federation/instanceActor'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetConfig = vi.fn()
vi.mock('@/lib/config', async () => ({
  getConfig: () => mockGetConfig(),
  getBaseURL: () => 'https://llun.test'
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', async () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto')
  const { promisify } = await vi.importActual('util')
  const mockGenerateKeyPair = vi.fn()
  mockGenerateKeyPair[promisify.custom] = () =>
    Promise.resolve({ publicKey: 'public-key', privateKey: 'private-key' })
  return {
    ...actual,
    generateKeyPair: mockGenerateKeyPair
  }
})

describe('POST /api/v1/actors', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    mockGetServerSession.mockReset()
    mockGetConfig.mockReset()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const createRequest = (body: Record<string, string>) =>
    new NextRequest('https://llun.test/api/v1/actors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    })

  it('uses the requested domain when it is allowed', async () => {
    mockGetConfig.mockReturnValue({ host: 'llun.test', allowEmails: [] })
    // allowActorDomains is a database-backed federation setting.
    await database.setServerSetting({
      key: 'federation.allowActorDomains',
      value: ['allowed.test', 'llun.test']
    })
    invalidateServerSettingsCache(database)

    try {
      const response = await POST(
        createRequest({ username: 'newactor-allowed', domain: 'allowed.test' }),
        { params: Promise.resolve({}) }
      )

      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.domain).toBe('allowed.test')
    } finally {
      await database.deleteServerSetting({
        key: 'federation.allowActorDomains'
      })
      invalidateServerSettingsCache(database)
    }
  })

  it('falls back to the current actor domain when none is provided', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['llun.test']
    })

    const response = await POST(
      createRequest({ username: 'newactor-default' }),
      { params: Promise.resolve({}) }
    )

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.domain).toBe('llun.test')
  })

  it('returns 400 when the request body is malformed JSON', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['llun.test']
    })

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/actors', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: 'not-json{'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
  })

  it('rejects domains that are not on the allow list', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['allowed.test']
    })

    const response = await POST(
      createRequest({ username: 'newactor-denied', domain: 'bad.test' }),
      { params: Promise.resolve({}) }
    )

    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toBe('Domain is not allowed')
  })

  it('rejects the reserved federation signing actor username', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['llun.test']
    })

    const response = await POST(
      createRequest({ username: FEDERATION_SIGNING_ACTOR_USERNAME }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
  })

  it('rejects usernames in the federation signing actor namespace', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['llun.test']
    })

    const response = await POST(
      createRequest({ username: `${FEDERATION_SIGNING_ACTOR_USERNAME}abc` }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
  })
})
