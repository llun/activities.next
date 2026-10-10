import {
  createFreshDatabaseRunner,
  createSigningAccount,
  seedActorTestDatabase
} from '@/lib/database/sql/actorTestHelpers'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  FEDERATION_SIGNING_ACTOR_TYPE,
  FEDERATION_SIGNING_ACTOR_USERNAME,
  getFederationSigningActorId,
  getFederationSigningActorUsername
} from '@/lib/services/federation/instanceActor'
import { EXTERNAL_ACTORS, TEST_DOMAIN, TEST_DOMAIN_2 } from '@/lib/stub/const'
import { generateKeyPair } from '@/lib/utils/signature'

// The signer mints its key pair through generateKeyPair. It stays the real one
// unless a test replaces a single call, to hold the mint open or to slip
// another process's signer in before the insert.
vi.mock('@/lib/utils/signature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/signature')>()
  return { ...actual, generateKeyPair: vi.fn(actual.generateKeyPair) }
})

describe('ActorDatabase federation signer', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (backendName, database) => {
    const withFreshDatabase = createFreshDatabaseRunner(backendName)

    beforeAll(async () => {
      await seedActorTestDatabase(database)
    })

    beforeEach(() => {
      vi.mocked(generateKeyPair).mockClear()
    })

    describe('getFederationSigningActor', () => {
      it('creates a dedicated headless instance actor with a private key', async () => {
        const actor = await database.getFederationSigningActor()

        expect(actor).toMatchObject({
          id: getFederationSigningActorId(TEST_DOMAIN),
          type: FEDERATION_SIGNING_ACTOR_TYPE,
          username: FEDERATION_SIGNING_ACTOR_USERNAME,
          domain: TEST_DOMAIN,
          privateKey: expect.toBeString(),
          publicKey: expect.toBeString()
        })
        expect(actor?.account).toBeUndefined()
      })

      it('returns one signer for concurrent first-run bootstrap calls', async () => {
        await withFreshDatabase(async (database) => {
          // The first mint is held open, so the second call arrives while it
          // is still running: it has to join it instead of minting its own.
          vi.mocked(generateKeyPair).mockImplementationOnce(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100))
            return { publicKey: 'public-minted', privateKey: 'private-minted' }
          })

          const [first, second] = await Promise.all([
            database.getFederationSigningActor(),
            database.getFederationSigningActor()
          ])

          expect(first?.id).toBe(getFederationSigningActorId(TEST_DOMAIN))
          expect(second?.id).toBe(first?.id)
          expect(first?.privateKey).toBe('private-minted')
          expect(second?.privateKey).toBe(first?.privateKey)
          expect(generateKeyPair).toHaveBeenCalledTimes(1)
        })
      })

      it('returns the signer another process stored first when its own insert loses', async () => {
        await withFreshDatabase(async (database) => {
          const reservedId = getFederationSigningActorId(TEST_DOMAIN)
          // The other process commits its signer while this one generates its
          // key pair, so the insert below hits the same id.
          vi.mocked(generateKeyPair).mockImplementationOnce(async () => {
            await database.createActor({
              actorId: reservedId,
              type: FEDERATION_SIGNING_ACTOR_TYPE,
              username: FEDERATION_SIGNING_ACTOR_USERNAME,
              domain: TEST_DOMAIN,
              followersUrl: `${reservedId}/followers`,
              inboxUrl: `${reservedId}/inbox`,
              sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
              publicKey: 'public-competing',
              privateKey: 'private-competing',
              createdAt: Date.now()
            })
            return { publicKey: 'public-minted', privateKey: 'private-minted' }
          })

          const actor = await database.getFederationSigningActor()

          expect(generateKeyPair).toHaveBeenCalledTimes(1)
          expect(actor).toMatchObject({
            id: reservedId,
            publicKey: 'public-competing',
            privateKey: 'private-competing'
          })
        })
      })

      it('creates the headless actor when no user actors exist', async () => {
        await withFreshDatabase(async (database) => {
          await database.createActor({
            actorId: EXTERNAL_ACTORS[0].id,
            username: EXTERNAL_ACTORS[0].username,
            domain: EXTERNAL_ACTORS[0].domain,
            followersUrl: EXTERNAL_ACTORS[0].followers_url,
            inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
            sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
            publicKey: 'publicKey',
            createdAt: Date.now()
          })

          await createSigningAccount(database, 'empty-key-signer', {
            privateKey: ''
          })
          await createSigningAccount(database, 'wrong-domain-signer', {
            domain: TEST_DOMAIN_2
          })

          const actor = await database.getFederationSigningActor()
          expect(actor).toMatchObject({
            id: getFederationSigningActorId(TEST_DOMAIN),
            type: FEDERATION_SIGNING_ACTOR_TYPE
          })
          expect(actor?.account).toBeUndefined()
        })
      })

      it('uses an alternate headless actor instead of a real user actor when the reserved id is unavailable', async () => {
        await withFreshDatabase(async (database) => {
          const username = 'deleting-signer'
          await createSigningAccount(database, username)

          await database.createActor({
            actorId: getFederationSigningActorId(TEST_DOMAIN),
            type: FEDERATION_SIGNING_ACTOR_TYPE,
            username: FEDERATION_SIGNING_ACTOR_USERNAME,
            domain: TEST_DOMAIN,
            followersUrl: `${getFederationSigningActorId(TEST_DOMAIN)}/followers`,
            inboxUrl: `${getFederationSigningActorId(TEST_DOMAIN)}/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: '',
            createdAt: Date.now()
          })

          const actor = await database.getFederationSigningActor()
          const fallbackUsername = getFederationSigningActorUsername(1)

          expect(actor).toMatchObject({
            id: getFederationSigningActorId(TEST_DOMAIN, fallbackUsername),
            type: FEDERATION_SIGNING_ACTOR_TYPE,
            username: fallbackUsername,
            domain: TEST_DOMAIN,
            privateKey: expect.toBeString()
          })
          expect(actor?.account).toBeUndefined()
        })
      })

      it('does not reuse arbitrary service actors as the federation signer', async () => {
        await withFreshDatabase(async (database) => {
          await database.createActor({
            actorId: `https://${TEST_DOMAIN}/users/not-the-instance`,
            type: FEDERATION_SIGNING_ACTOR_TYPE,
            username: 'not-the-instance',
            domain: TEST_DOMAIN,
            followersUrl: `https://${TEST_DOMAIN}/users/not-the-instance/followers`,
            inboxUrl: `https://${TEST_DOMAIN}/users/not-the-instance/inbox`,
            sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
            publicKey: 'public-key',
            privateKey: 'private-key',
            createdAt: Date.now()
          })

          const actor = await database.getFederationSigningActor()

          expect(actor?.id).toBe(getFederationSigningActorId(TEST_DOMAIN))
          expect(actor?.username).toBe(FEDERATION_SIGNING_ACTOR_USERNAME)
        })
      })

      it('deterministically returns the reserved headless actor', async () => {
        await withFreshDatabase(async (database) => {
          await createSigningAccount(database, 'older-signer')
          await new Promise((resolve) => setTimeout(resolve, 5))
          await createSigningAccount(database, 'newer-signer')

          const createSigner = (username: string, createdAt: number) => {
            const actorId = getFederationSigningActorId(TEST_DOMAIN, username)
            return database.createActor({
              actorId,
              type: FEDERATION_SIGNING_ACTOR_TYPE,
              username,
              domain: TEST_DOMAIN,
              followersUrl: `${actorId}/followers`,
              inboxUrl: `${actorId}/inbox`,
              sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
              publicKey: `public-${username}`,
              privateKey: `private-${username}`,
              createdAt
            })
          }
          // Two valid headless signers. The adoption query would pick the older
          // one, but the reserved id is asked for first and wins whatever its age.
          await createSigner(getFederationSigningActorUsername(1), 100)
          await createSigner(FEDERATION_SIGNING_ACTOR_USERNAME, 200)

          const first = await database.getFederationSigningActor()
          const second = await database.getFederationSigningActor()

          expect(first?.id).toBe(getFederationSigningActorId(TEST_DOMAIN))
          expect(first?.privateKey).toBe(
            `private-${FEDERATION_SIGNING_ACTOR_USERNAME}`
          )
          expect(second?.id).toBe(first?.id)
          expect(second?.privateKey).toBe(first?.privateKey)
          expect(generateKeyPair).not.toHaveBeenCalled()
        })
      })
    })
  })
})
