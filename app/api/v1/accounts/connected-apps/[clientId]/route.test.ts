import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: []
  })
}))

type MockDatabase = Pick<
  Database,
  'getAccountFromEmail' | 'getActorsForAccount' | 'revokeAccountConnectedApp'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

const account = {
  id: 'account-1',
  email: seedActor1.email,
  defaultActorId: ACTOR1_ID
}

const actor = { ...seedActor1, id: ACTOR1_ID, account }

const buildRequest = (url: string) =>
  new NextRequest(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://llun.test'
    }
  })

describe('DELETE /api/v1/accounts/connected-apps/[clientId]', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    revokeAccountConnectedApp: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email },
      session: { token: 'current-token' }
    })
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.revokeAccountConnectedApp.mockResolvedValue(undefined)
  })

  it('revokes the grant scoped to the actor from the query param', async () => {
    const response = await DELETE(
      buildRequest(
        'http://llun.test/api/v1/accounts/connected-apps/ice-cubes?actorId=actor-anna'
      ),
      { params: Promise.resolve({ clientId: 'ice-cubes' }) }
    )

    expect(response.status).toBe(200)
    expect(mockDb.revokeAccountConnectedApp).toHaveBeenCalledWith({
      accountId: account.id,
      clientId: 'ice-cubes',
      actorId: 'actor-anna'
    })
  })

  it.each([
    ['absent', 'http://llun.test/api/v1/accounts/connected-apps/la-suite-docs'],
    [
      'empty',
      'http://llun.test/api/v1/accounts/connected-apps/la-suite-docs?actorId='
    ]
  ])(
    'passes a null actorId when the query param is %s',
    async (_label, url) => {
      await DELETE(buildRequest(url), {
        params: Promise.resolve({ clientId: 'la-suite-docs' })
      })

      expect(mockDb.revokeAccountConnectedApp).toHaveBeenCalledWith({
        accountId: account.id,
        clientId: 'la-suite-docs',
        actorId: null
      })
    }
  )

  it('returns 400 when the clientId is missing', async () => {
    const response = await DELETE(
      buildRequest('http://llun.test/api/v1/accounts/connected-apps/'),
      { params: Promise.resolve({ clientId: '' }) }
    )

    expect(response.status).toBe(400)
    expect(mockDb.revokeAccountConnectedApp).not.toHaveBeenCalled()
  })
})
