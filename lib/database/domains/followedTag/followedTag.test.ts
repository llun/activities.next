import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'

const ACTOR_ID = 'https://test.llun.dev/users/owner'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  // Each test starts from an empty, migrated database.
  const testDb = createTestDatabase()
  await testDb.prepare()
  await testDb.database.migrate()
  try {
    await test(testDb.database)
  } finally {
    await testDb.destroy()
  }
}

describe('FollowedTagDatabase', () => {
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

  it('pages the window immediately newer than min_id, newest first', async () => {
    await withFreshDatabase(async (database) => {
      for (const name of ['first', 'second', 'third', 'fourth']) {
        await database.followTag({ actorId: ACTOR_ID, name })
      }

      // Newest-first baseline; index 3 is the oldest row.
      const all = await database.getFollowedTags({ actorId: ACTOR_ID })
      expect(all).toHaveLength(4)

      const page = await database.getFollowedTags({
        actorId: ACTOR_ID,
        minId: all[3].id,
        limit: 2
      })

      // min_id pages upward from the cursor: the two rows immediately newer
      // than the oldest one, still returned newest-first. since_id semantics
      // would instead return the two newest rows (all[0], all[1]).
      expect(page.map((tag) => tag.id)).toEqual([all[1].id, all[2].id])
    })
  })
})
