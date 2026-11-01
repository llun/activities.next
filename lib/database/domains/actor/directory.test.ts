import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestDatabaseWithInstance
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN } from '@/lib/stub/const'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  // Isolated: the suite-level database stays open beside this one.
  const { database, prepare } = getTestDatabaseWithInstance(true)
  await prepare()
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
})
