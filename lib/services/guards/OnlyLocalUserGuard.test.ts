import { NextRequest, NextResponse } from 'next/server'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { FEDERATION_SIGNING_ACTOR_USERNAME } from '@/lib/services/federation/instanceActor'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { OnlyLocalUserGuard } from './OnlyLocalUserGuard'

// Mock database getter
let mockDatabase:
  ReturnType<typeof getTestSQLDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/config', async () => {
  const { TEST_DOMAIN } = await vi.importActual('@/lib/stub/const')
  const { MOCK_SECRET_PHASES } = await vi.importActual('@/lib/stub/actor')

  return {
    getConfig: () => ({
      host: TEST_DOMAIN,
      allowActorDomains: ['actor.llun.test'],
      trustedHosts: ['llun.test'],
      secretPhase: MOCK_SECRET_PHASES
    })
  }
})

describe('OnlyLocalUserGuard', () => {
  const { database, instance } = getTestSQLDatabaseWithInstance()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  const createRequest = (host = 'llun.test') => {
    return new NextRequest('https://llun.test/api/test', {
      method: 'GET',
      headers: {
        host
      }
    })
  }

  const mockHandler = vi.fn().mockImplementation(() => {
    return NextResponse.json({ success: true }, { status: 200 })
  })

  beforeEach(() => {
    mockHandler.mockClear()
  })

  describe('with valid local user', () => {
    it('calls handler for local user', async () => {
      const guard = OnlyLocalUserGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, {
        params: Promise.resolve({ username: seedActor1.username })
      })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    it('returns 404 for the headless instance actor by default', async () => {
      await database.getFederationSigningActor()

      const guard = OnlyLocalUserGuard(mockHandler)
      const req = createRequest(TEST_DOMAIN)
      const response = await guard(req, {
        params: Promise.resolve({
          username: FEDERATION_SIGNING_ACTOR_USERNAME
        })
      })

      expect(response.status).toBe(404)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    it('calls handler for the headless instance actor when explicitly allowed', async () => {
      await database.getFederationSigningActor()

      const guard = OnlyLocalUserGuard(mockHandler, {
        allowFederationSigningActor: true
      })
      const req = createRequest(TEST_DOMAIN)
      const response = await guard(req, {
        params: Promise.resolve({
          username: FEDERATION_SIGNING_ACTOR_USERNAME
        })
      })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })
  })

  // The ActivityPub surface this guard fronts — actor document, inbox, outbox,
  // followers, following, statuses, collections — used to resolve by rebuilding
  // the actor id from the path segment, which could only ever match one
  // spelling. `/@user`, WebFinger, mentions and account lookup all fold casing,
  // so this one answering `/api/users/Test1` and 404ing `/api/users/test1` was
  // the odd one out.
  describe('with a differently-cased username in the path', () => {
    it.each([
      { description: 'all uppercase', username: 'TEST1' },
      { description: 'a leading capital', username: 'Test1' }
    ])(
      'resolves a local actor asked for in $description',
      async ({ username }) => {
        const guard = OnlyLocalUserGuard(mockHandler)
        const req = createRequest()
        const response = await guard(req, {
          params: Promise.resolve({ username })
        })

        expect(response.status).toBe(200)
        expect(mockHandler).toHaveBeenCalled()
      }
    )

    it('resolves the headless instance actor in any casing when allowed', async () => {
      await database.getFederationSigningActor()

      const guard = OnlyLocalUserGuard(mockHandler, {
        allowFederationSigningActor: true
      })
      const req = createRequest(TEST_DOMAIN)
      const response = await guard(req, {
        params: Promise.resolve({ username: '__INSTANCE__' })
      })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })

    it('still binds the actor to the requested host', async () => {
      const guard = OnlyLocalUserGuard(mockHandler)
      const req = createRequest('someone.else.test')
      const response = await guard(req, {
        params: Promise.resolve({ username: 'TEST1' })
      })

      expect(response.status).toBe(404)
      expect(mockHandler).not.toHaveBeenCalled()
    })
  })

  // Resolving by username is what made this reachable. `__INSTANCE__` was
  // registerable before the reserved-name refine folded casing, and the folded
  // arm then answers a request for `__instance__` with that account's actor —
  // at `getFederationSigningActorId(domain)` itself, and past the
  // `actor.account` check even without `allowFederationSigningActor`. The old
  // id-rebuild could not reach that state.
  describe('with a squatter at the reserved instance-actor username', () => {
    const SQUATTER_ID = 'https://llun.test/users/__INSTANCE__'

    beforeAll(async () => {
      const accountId = await database.createAccount({
        email: 'squatter@squat.test',
        username: 'squatter',
        domain: 'llun.test',
        passwordHash: 'hash',
        privateKey: 'privateKey',
        publicKey: 'publicKey'
      })
      // Written through raw knex on purpose: every mint path refuses a reserved
      // name AND lowercases, so only a row predating both can look like this.
      // It must carry an accountId, or the guard's pre-existing
      // `actor?.account` check would 404 it and this suite would prove nothing.
      await instance('actors').insert({
        id: SQUATTER_ID,
        username: '__INSTANCE__',
        domain: 'llun.test',
        accountId,
        publicId: 'squatter-public-id-00000000000000000',
        type: 'Person',
        publicKey: 'publicKey',
        privateKey: 'privateKey',
        settings: JSON.stringify({
          followersUrl: `${SQUATTER_ID}/followers`,
          inboxUrl: `${SQUATTER_ID}/inbox`,
          sharedInboxUrl: 'https://llun.test/inbox'
        }),
        createdAt: new Date(),
        updatedAt: new Date()
      })
    })

    it('confirms the squatter is a local account actor', async () => {
      // Guards the guard test: without an account the 404 below would come from
      // the pre-existing `actor?.account` check and assert nothing new.
      const actor = await database.getActorFromUsername({
        username: '__INSTANCE__',
        domain: 'llun.test'
      })
      expect(actor?.id).toBe(SQUATTER_ID)
      expect(actor?.account).toBeTruthy()
    })

    // The guard reserves exactly the names the minter can EMIT — bare
    // `__instance__` and `__instance__<n>` for n >= 1 — not the loose
    // `__instance__` PREFIX the mint refine reserves, and NOT
    // `__instance__<digits>` either: the two zero-index rows below ARE digits
    // and are deliberately served, because the index is an interpolated JS
    // number that never carries a leading zero.
    //
    // A legacy account named `__instance__archive` —
    // registerable before that refine existed — owns an id
    // `getFederationSigningActorId` cannot produce at any index, so 404ing it
    // would silently de-federate a working actor: no actor document, no inbox
    // deliveries, and no dereference of its already-federated statuses.
    it.each([
      { description: 'a non-numeric suffix', username: '__instance__archive' },
      { description: 'an underscore suffix', username: '__instance___backup' },
      // The index is an interpolated JS number, so the minter emits bare
      // `__instance__` for 0 and never `__instance__0`. A `\d*` predicate
      // refused this one anyway, de-federating it for a name that cannot
      // collide with any signer.
      {
        description: 'a zero index the minter never emits',
        username: '__instance__0'
      },
      { description: 'a leading-zero index', username: '__instance__007' }
    ])(
      'still serves a legacy account whose name merely begins __instance__ ($description)',
      async ({ username }) => {
        const accountId = await database.createAccount({
          email: `${username}@legacy.test`,
          username: `holder${username}`,
          domain: 'llun.test',
          passwordHash: 'hash',
          privateKey: 'privateKey',
          publicKey: 'publicKey'
        })
        const id = `https://llun.test/users/${username}`
        await instance('actors').insert({
          id,
          username,
          domain: 'llun.test',
          accountId,
          publicId: `legacy${username}`.padEnd(36, '0').slice(0, 36),
          type: 'Person',
          publicKey: 'publicKey',
          privateKey: 'privateKey',
          settings: JSON.stringify({
            followersUrl: `${id}/followers`,
            inboxUrl: `${id}/inbox`,
            sharedInboxUrl: 'https://llun.test/inbox'
          }),
          createdAt: new Date(),
          updatedAt: new Date()
        })

        const guard = OnlyLocalUserGuard(mockHandler)
        const req = createRequest()
        const response = await guard(req, {
          params: Promise.resolve({ username })
        })

        expect(response.status).toBe(200)
        expect(mockHandler).toHaveBeenCalled()
      }
    )

    it.each([
      { description: 'requested in lowercase', requested: '__instance__' },
      {
        description: 'requested in the stored casing',
        requested: '__INSTANCE__'
      }
    ])(
      '404s a legacy __INSTANCE__ account $description',
      async ({ requested }) => {
        const guard = OnlyLocalUserGuard(mockHandler)
        const req = createRequest()
        const response = await guard(req, {
          params: Promise.resolve({ username: requested })
        })

        expect(response.status).toBe(404)
        expect(mockHandler).not.toHaveBeenCalled()
      }
    )
  })

  // An INDEXED signing username. Separate from the `__INSTANCE__` block because
  // it needs its own seeded row: asserting a 404 for `__instance__1` with no
  // such actor present proves nothing — it takes the pre-existing "actor not
  // found" branch and passes with the reserved-name check deleted entirely.
  describe('with a squatter at an indexed instance-actor username', () => {
    beforeAll(async () => {
      const accountId = await database.createAccount({
        email: 'indexed@squat.test',
        username: 'indexedholder',
        domain: 'llun.test',
        passwordHash: 'hash',
        privateKey: 'privateKey',
        publicKey: 'publicKey'
      })
      const id = 'https://llun.test/users/__instance__2'
      await instance('actors').insert({
        id,
        username: '__instance__2',
        domain: 'llun.test',
        accountId,
        publicId: 'indexed-squatter-id-0000000000000000',
        type: 'Person',
        publicKey: 'publicKey',
        privateKey: 'privateKey',
        settings: JSON.stringify({
          followersUrl: `${id}/followers`,
          inboxUrl: `${id}/inbox`,
          sharedInboxUrl: 'https://llun.test/inbox'
        }),
        createdAt: new Date(),
        updatedAt: new Date()
      })
    })

    it('confirms the indexed squatter resolves as a local account actor', async () => {
      const actor = await database.getActorFromUsername({
        username: '__instance__2',
        domain: 'llun.test'
      })
      expect(actor?.id).toBe('https://llun.test/users/__instance__2')
      expect(actor?.account).toBeTruthy()
    })

    it('404s it, because __instance__2 is a name the minter can emit', async () => {
      const guard = OnlyLocalUserGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, {
        params: Promise.resolve({ username: '__instance__2' })
      })

      expect(response.status).toBe(404)
      expect(mockHandler).not.toHaveBeenCalled()
    })
  })

  describe('with invalid user', () => {
    it('returns 404 when user not found', async () => {
      const guard = OnlyLocalUserGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, {
        params: Promise.resolve({ username: 'nonexistent' })
      })

      expect(response.status).toBe(404)
      expect(mockHandler).not.toHaveBeenCalled()
    })
  })

  describe('with a moderated local actor', () => {
    it('returns 410 Gone for suspended local actors', async () => {
      const actor = await database.getActorFromUsername({
        username: seedActor1.username,
        domain: 'llun.test'
      })
      await database.setActorSuspended({ actorId: actor!.id, suspended: true })

      try {
        const guard = OnlyLocalUserGuard(mockHandler)
        const req = createRequest()
        const response = await guard(req, {
          params: Promise.resolve({ username: seedActor1.username })
        })

        expect(response.status).toBe(410)
        expect(mockHandler).not.toHaveBeenCalled()
      } finally {
        await database.setActorSuspended({
          actorId: actor!.id,
          suspended: false
        })
      }
    })

    it('still resolves silenced actors', async () => {
      const actor = await database.getActorFromUsername({
        username: seedActor1.username,
        domain: 'llun.test'
      })
      await database.setActorSilenced({ actorId: actor!.id, silenced: true })

      try {
        const guard = OnlyLocalUserGuard(mockHandler)
        const req = createRequest()
        const response = await guard(req, {
          params: Promise.resolve({ username: seedActor1.username })
        })

        expect(response.status).toBe(200)
        expect(mockHandler).toHaveBeenCalled()
      } finally {
        await database.setActorSilenced({ actorId: actor!.id, silenced: false })
      }
    })
  })

  describe('without database', () => {
    it('returns 500 when database unavailable', async () => {
      const originalDb = mockDatabase
      mockDatabase = null

      const guard = OnlyLocalUserGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, {
        params: Promise.resolve({ username: seedActor1.username })
      })

      expect(response.status).toBe(500)
      expect(mockHandler).not.toHaveBeenCalled()

      mockDatabase = originalDb
    })
  })
})
