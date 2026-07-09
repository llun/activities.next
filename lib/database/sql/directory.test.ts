import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabase
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { EXTERNAL_ACTORS, TEST_DOMAIN, testUserId } from '@/lib/stub/const'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const database = getTestSQLDatabase()
  await database.migrate()
  try {
    await test(database)
  } finally {
    await database.destroy()
  }
}

describe('directory and peers', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  const createLocalAccount = (database: Database, username: string) =>
    database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: 'hash',
      domain: TEST_DOMAIN,
      privateKey: `privateKey-${username}`,
      publicKey: `publicKey-${username}`
    })

  describe('getLocalMastodonActors', () => {
    it('lists only local actors that belong to an account', async () => {
      await withFreshDatabase(async (database) => {
        await createLocalAccount(database, 'alice')
        await createLocalAccount(database, 'bob')

        // A remote actor (no local account) must not appear in the directory.
        await database.createActor({
          actorId: EXTERNAL_ACTORS[0].id,
          username: EXTERNAL_ACTORS[0].username,
          domain: EXTERNAL_ACTORS[0].domain,
          followersUrl: EXTERNAL_ACTORS[0].followers_url,
          inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
          sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
          publicKey: 'remote-public-key',
          createdAt: Date.now()
        })

        const actors = await database.getLocalMastodonActors({
          localDomain: TEST_DOMAIN
        })
        const usernames = actors.map((actor) => actor.username).sort()
        expect(usernames).toEqual(['alice', 'bob'])
      })
    })

    it('honors limit and offset', async () => {
      await withFreshDatabase(async (database) => {
        await createLocalAccount(database, 'alice')
        await createLocalAccount(database, 'bob')
        await createLocalAccount(database, 'carol')

        const firstPage = await database.getLocalMastodonActors({
          localDomain: TEST_DOMAIN,
          limit: 2,
          offset: 0
        })
        expect(firstPage).toHaveLength(2)

        const secondPage = await database.getLocalMastodonActors({
          localDomain: TEST_DOMAIN,
          limit: 2,
          offset: 2
        })
        expect(secondPage).toHaveLength(1)
      })
    })

    it('orders by the most recent status when order is active', async () => {
      await withFreshDatabase(async (database) => {
        await createLocalAccount(database, 'alice')
        await createLocalAccount(database, 'bob')
        await createLocalAccount(database, 'carol')

        const now = Date.now()
        const createNote = (username: string, createdAt: number) =>
          database.createNote({
            id: `${testUserId(username)}/statuses/1`,
            url: `${testUserId(username)}/statuses/1`,
            actorId: testUserId(username),
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: `post by ${username}`,
            createdAt
          })
        // bob posted most recently, alice earlier, carol never.
        await createNote('alice', now - 60_000)
        await createNote('bob', now - 1000)

        const actors = await database.getLocalMastodonActors({
          localDomain: TEST_DOMAIN,
          order: 'active'
        })
        expect(actors.map((actor) => actor.username)).toEqual([
          'bob',
          'alice',
          'carol'
        ])
      })
    })

    it('includes known remote actors when local is false', async () => {
      await withFreshDatabase(async (database) => {
        await createLocalAccount(database, 'alice')
        await database.createActor({
          actorId: EXTERNAL_ACTORS[0].id,
          username: EXTERNAL_ACTORS[0].username,
          domain: EXTERNAL_ACTORS[0].domain,
          followersUrl: EXTERNAL_ACTORS[0].followers_url,
          inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
          sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
          publicKey: 'remote-public-key',
          createdAt: Date.now()
        })

        const actors = await database.getLocalMastodonActors({
          localDomain: TEST_DOMAIN,
          local: false
        })
        const usernames = actors.map((actor) => actor.username).sort()
        expect(usernames).toEqual(['actor_id', 'alice'])
      })
    })

    it('excludes internal local system actors (no account) when local is false', async () => {
      await withFreshDatabase(async (database) => {
        await createLocalAccount(database, 'alice')
        // A local-domain actor with no backing account stands in for an
        // internal system actor such as the headless federation signer
        // (accountId null on the local domain). It must never surface in the
        // public directory, even in the all-profiles (local=false) view.
        const systemActorId = testUserId('__system__')
        await database.createActor({
          actorId: systemActorId,
          username: '__system__',
          domain: TEST_DOMAIN,
          followersUrl: `${systemActorId}/followers`,
          inboxUrl: `${systemActorId}/inbox`,
          sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
          publicKey: 'system-public-key',
          createdAt: Date.now()
        })

        const actors = await database.getLocalMastodonActors({
          localDomain: TEST_DOMAIN,
          local: false
        })
        const usernames = actors.map((actor) => actor.username)
        expect(usernames).toContain('alice')
        expect(usernames).not.toContain('__system__')
      })
    })
  })

  describe('getInstancePeers', () => {
    it('returns distinct remote domains, excluding the local domain', async () => {
      await withFreshDatabase(async (database) => {
        await createLocalAccount(database, 'alice')

        await database.createActor({
          actorId: EXTERNAL_ACTORS[0].id,
          username: EXTERNAL_ACTORS[0].username,
          domain: EXTERNAL_ACTORS[0].domain,
          followersUrl: EXTERNAL_ACTORS[0].followers_url,
          inboxUrl: EXTERNAL_ACTORS[0].inbox_url,
          sharedInboxUrl: EXTERNAL_ACTORS[0].inbox_url,
          publicKey: 'remote-public-key',
          createdAt: Date.now()
        })

        const peers = await database.getInstancePeers({
          localDomain: TEST_DOMAIN
        })
        expect(peers).toContain(EXTERNAL_ACTORS[0].domain)
        expect(peers).not.toContain(TEST_DOMAIN)
      })
    })
  })
})
