import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'

const holder = vi.hoisted(() => ({
  testDb: null as TestDatabase | null,
  database: null as unknown
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'test.example.com',
    serviceName: 'Activities.next Test',
    secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
    trustedHosts: []
  }),
  getBaseURL: () => 'https://test.example.com'
}))

vi.mock('@/lib/database', () => ({
  getKysely: () => holder.testDb?.db,
  getDatabase: () => holder.database
}))

const ACCOUNT_ID = 'account-1'

const account = (overrides: Record<string, unknown> = {}) => ({
  id: ACCOUNT_ID,
  defaultActorId: null,
  verificationCode: '',
  emailVerified: true,
  verifiedAt: 1,
  disabledAt: null,
  approvedAt: 1,
  ...overrides
})

const actor = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  suspendedAt: null,
  deletionStatus: null,
  ...overrides
})

const sessionRecord = () => ({
  id: 'session-1',
  userId: ACCOUNT_ID,
  token: 'token',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  expiresAt: new Date(1)
})

const getAccountFromId = vi.fn()
const getActorsForAccount = vi.fn()

const sessionCreateBefore = async () => {
  const { getAuth } = await import('@/lib/services/auth/auth')
  const auth = getAuth('https://session-actor-hook.example.com', 'Test')
  const before = auth.options.databaseHooks?.session?.create?.before
  if (typeof before !== 'function') {
    throw new Error('session create hook is not a function')
  }
  return before
}

describe('session create hook actor selection', () => {
  beforeAll(async () => {
    const testDb = createTestDatabase()
    await testDb.prepareEmpty()
    holder.testDb = testDb
  })

  afterAll(async () => {
    await holder.testDb?.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    holder.database = {
      getAccountFromId,
      getActorsForAccount
    }
    getAccountFromId.mockResolvedValue(account())
    getActorsForAccount.mockResolvedValue([
      actor('https://test.example.com/users/one')
    ])
  })

  it('mints the session for a usable actor instead of a suspended default', async () => {
    const suspendedDefault = 'https://test.example.com/users/suspended'
    const usable = 'https://test.example.com/users/usable'
    getAccountFromId.mockResolvedValue(
      account({ defaultActorId: suspendedDefault })
    )
    getActorsForAccount.mockResolvedValue([
      actor(suspendedDefault, { suspendedAt: 1 }),
      actor(usable)
    ])

    const before = await sessionCreateBefore()
    const result = await before(sessionRecord())

    expect(result).toEqual({
      data: expect.objectContaining({ actorId: usable })
    })
  })

  it('keeps the suspended default when no actor is usable, so guards still refuse', async () => {
    const suspendedDefault = 'https://test.example.com/users/suspended'
    getAccountFromId.mockResolvedValue(
      account({ defaultActorId: suspendedDefault })
    )
    getActorsForAccount.mockResolvedValue([
      actor(suspendedDefault, { suspendedAt: 1 })
    ])

    const before = await sessionCreateBefore()
    const result = await before(sessionRecord())

    // Every actor suspended: sign-in is refused outright.
    expect(result).toBe(false)
  })
})
