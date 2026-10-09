import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN } from '@/lib/stub/const'

export const withFreshDatabase = async (
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

export const createLocalAccount = (database: Database, username: string) =>
  database.createAccount({
    email: `${username}@${TEST_DOMAIN}`,
    username,
    passwordHash: 'hash',
    domain: TEST_DOMAIN,
    privateKey: `privateKey-${username}`,
    publicKey: `publicKey-${username}`
  })
