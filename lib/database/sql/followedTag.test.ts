import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabase
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'

const ACTOR_ID = 'https://test.llun.dev/users/owner'

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

describe('FollowedTagDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  it('follows a tag idempotently and normalizes the name', async () => {
    await withFreshDatabase(async (database) => {
      const first = await database.followTag({
        actorId: ACTOR_ID,
        name: '#Running'
      })
      expect(first.name).toBe('Running')

      // A repeated follow (with the leading hash or different case) is a no-op.
      const second = await database.followTag({
        actorId: ACTOR_ID,
        name: 'running'
      })
      expect(second.id).toBe(first.id)

      expect(
        await database.isFollowingTag({ actorId: ACTOR_ID, name: 'RUNNING' })
      ).toBe(true)

      const tags = await database.getFollowedTags({ actorId: ACTOR_ID })
      expect(tags).toHaveLength(1)
    })
  })

  it('unfollows a tag', async () => {
    await withFreshDatabase(async (database) => {
      await database.followTag({ actorId: ACTOR_ID, name: 'cycling' })
      const removed = await database.unfollowTag({
        actorId: ACTOR_ID,
        name: 'cycling'
      })
      expect(removed).not.toBeNull()
      expect(
        await database.isFollowingTag({ actorId: ACTOR_ID, name: 'cycling' })
      ).toBe(false)
      expect(
        await database.unfollowTag({ actorId: ACTOR_ID, name: 'cycling' })
      ).toBeNull()
    })
  })
})
