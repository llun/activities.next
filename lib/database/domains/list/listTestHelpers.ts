import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN } from '@/lib/stub/const'

// A database of its own for one test, on the backend TEST_DATABASE_TYPE names
// (PostgreSQL in CI's test-pg job). A suite using it must not hold another
// database open alongside: on PostgreSQL `prepare` resets this
// worker's database.
export const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const testDb = createTestDatabase()
  await testDb.prepare()
  await testDb.database.migrate()
  try {
    await test(testDb.database)
  } finally {
    await testDb.database.destroy()
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
