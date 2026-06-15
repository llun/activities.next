import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
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

describe('DELETE /api/v1/profile/avatar', () => {
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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const createRequest = () =>
    new NextRequest('https://llun.test/api/v1/profile/avatar', {
      method: 'DELETE',
      headers: { origin: 'https://llun.test' }
    })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await DELETE(createRequest(), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })

  it('clears the actor icon and returns the credential account', async () => {
    await database.updateActor({
      actorId: ACTOR1_ID,
      iconUrl: 'https://llun.test/icon.png'
    })
    const actorBefore = await database.getActorFromId({ id: ACTOR1_ID })
    expect(actorBefore?.iconUrl).toBe('https://llun.test/icon.png')

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)

    const actorAfter = await database.getActorFromId({ id: ACTOR1_ID })
    expect(actorAfter?.iconUrl).toBeUndefined()

    const body = await response.json()
    expect(body.source).toBeDefined()
    // avatar should be empty string (getMastodonActorFromSQLActor default for no iconUrl)
    expect(body.avatar).toBe('')
  })
})
