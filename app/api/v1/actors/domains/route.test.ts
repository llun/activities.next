import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '../../../../../lib/database/testUtils'
import { seedDatabase } from '../../../../../lib/stub/database'
import { seedActor1 } from '../../../../../lib/stub/seed/actor1'
import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('../../../auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

const mockGetConfig = jest.fn()
jest.mock('../../../../../lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('../../../../../lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('GET /api/v1/actors/domains', () => {
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

  const createRequest = () =>
    new NextRequest('https://llun.test/api/v1/actors/domains', {
      method: 'GET'
    })

  it('returns the host as the only domain when allowActorDomains is not set', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: []
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.domains).toEqual(['llun.test'])
    expect(data.host).toBe('llun.test')
  })

  it('returns allowActorDomains when it is set', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['domain1.test', 'domain2.test', 'llun.test']
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.domains).toEqual(['domain1.test', 'domain2.test', 'llun.test'])
    expect(data.host).toBe('llun.test')
  })

  it('returns host from config', async () => {
    mockGetConfig.mockReturnValue({
      host: 'main.test',
      allowEmails: [],
      allowActorDomains: ['allowed.test']
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.host).toBe('main.test')
  })
})
