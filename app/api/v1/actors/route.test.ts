import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '../../../../lib/database/testUtils'
import { seedDatabase } from '../../../../lib/stub/database'
import { seedActor1 } from '../../../../lib/stub/seed/actor1'
import { POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('../../auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

const mockGetConfig = jest.fn()
jest.mock('../../../../lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('../../../../lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto')
  const { promisify } = jest.requireActual('util')
  const mockGenerateKeyPair = jest.fn()
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

  it('uses the requested domain when it is allowed', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['allowed.test', 'llun.test']
    })

    const response = await POST(
      createRequest({ username: 'newactor-allowed', domain: 'allowed.test' }),
      { params: Promise.resolve({}) }
    )

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.domain).toBe('allowed.test')
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
})
