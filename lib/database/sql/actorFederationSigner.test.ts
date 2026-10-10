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
          const [first, second] = await Promise.all([
            database.getFederationSigningActor(),
            database.getFederationSigningActor()
          ])

          expect(first?.id).toBe(getFederationSigningActorId(TEST_DOMAIN))
          expect(second?.id).toBe(first?.id)
          expect(second?.privateKey).toBe(first?.privateKey)
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

          const first = await database.getFederationSigningActor()
          const second = await database.getFederationSigningActor()

          expect(first?.id).toBe(getFederationSigningActorId(TEST_DOMAIN))
          expect(second?.id).toBe(first?.id)
          expect(second?.privateKey).toBe(first?.privateKey)
        })
      })
    })
  })
})
