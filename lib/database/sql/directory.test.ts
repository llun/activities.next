import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabase
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { EXTERNAL_ACTORS, TEST_DOMAIN } from '@/lib/stub/const'

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
