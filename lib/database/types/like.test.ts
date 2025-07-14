import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'

describe('LikeDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    describe('isActorLikedStatus', () => {
      it('returns true if actor has liked the status', async () => {
        const isLiked = await database.isActorLikedStatus({
          actorId: ACTOR2_ID,
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })
        expect(isLiked).toBeTrue()
      })

      it('returns false if actor has not liked the status', async () => {
        const isLiked = await database.isActorLikedStatus({
          actorId: ACTOR1_ID,
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })
        expect(isLiked).toBeFalse()
      })

      it('returns false if status does not exist', async () => {
        const isLiked = await database.isActorLikedStatus({
          actorId: ACTOR1_ID,
          statusId: 'https://nonexistent.status/id'
        })
        expect(isLiked).toBeFalse()
      })
    })

    describe('getLikeCount', () => {
      it('returns correct count for a liked status', async () => {
        const count = await database.getLikeCount({
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })
        expect(count).toBe(1)
      })

      it('returns zero for a status with no likes', async () => {
        const count = await database.getLikeCount({
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })
        expect(count).toBe(0)
      })

      it('returns zero for a nonexistent status', async () => {
        const count = await database.getLikeCount({
          statusId: 'https://nonexistent.status/id'
        })
        expect(count).toBe(0)
      })
    })

    describe('createLike', () => {
      it('creates a new like for a status', async () => {
        // Check initial state
        const beforeLikeCount = await database.getLikeCount({
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })
        const beforeIsLiked = await database.isActorLikedStatus({
          actorId: ACTOR4_ID,
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })
        expect(beforeLikeCount).toBe(0)
        expect(beforeIsLiked).toBeFalse()

        // Create the like
        await database.createLike({
          actorId: ACTOR4_ID,
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })

        // Verify like was created
        const afterLikeCount = await database.getLikeCount({
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })
        const afterIsLiked = await database.isActorLikedStatus({
          actorId: ACTOR4_ID,
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })
        expect(afterLikeCount).toBe(1)
        expect(afterIsLiked).toBeTrue()

        // Verify reflected in status object
        const status = await database.getStatus({
          statusId: `${ACTOR1_ID}/statuses/post-1`,
          currentActorId: ACTOR4_ID
        })
        expect(status).toMatchObject({
          isActorLiked: true,
          totalLikes: 1
        })
      })

      it('does not create duplicate likes for the same actor and status', async () => {
        // Create the like
        await database.createLike({
          actorId: ACTOR4_ID,
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })

        // Create the same like again
        await database.createLike({
          actorId: ACTOR4_ID,
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })

        // Verify count is still 1
        const likeCount = await database.getLikeCount({
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })
        expect(likeCount).toBe(1)
      })

      it('does nothing when status does not exist', async () => {
        await database.createLike({
          actorId: ACTOR1_ID,
          statusId: 'https://nonexistent.status/id'
        })

        const isLiked = await database.isActorLikedStatus({
          actorId: ACTOR1_ID,
          statusId: 'https://nonexistent.status/id'
        })
        expect(isLiked).toBeFalse()
      })
    })

    describe('deleteLike', () => {
      it('deletes an existing like', async () => {
        // Create a like first
        await database.createLike({
          actorId: ACTOR1_ID,
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })

        // Verify like exists
        const beforeIsLiked = await database.isActorLikedStatus({
          actorId: ACTOR1_ID,
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })
        const beforeLikeCount = await database.getLikeCount({
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })
        expect(beforeIsLiked).toBeTrue()
        expect(beforeLikeCount).toBe(2) // Original like + the one we just created

        // Delete the like
        await database.deleteLike({
          actorId: ACTOR1_ID,
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })

        // Verify like is deleted
        const afterIsLiked = await database.isActorLikedStatus({
          actorId: ACTOR1_ID,
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })
        const afterLikeCount = await database.getLikeCount({
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })
        expect(afterIsLiked).toBeFalse()
        expect(afterLikeCount).toBe(1) // Back to just the original like

        // Verify reflected in status object
        const status = await database.getStatus({
          statusId: `${ACTOR3_ID}/statuses/poll-1`,
          currentActorId: ACTOR1_ID
        })
        expect(status).toMatchObject({
          isActorLiked: false,
          totalLikes: 1
        })
      })

      it('does nothing when the like does not exist', async () => {
        // Check initial state
        const beforeLikeCount = await database.getLikeCount({
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })

        // Delete a nonexistent like
        await database.deleteLike({
          actorId: ACTOR3_ID,
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })

        // Verify count is unchanged
        const afterLikeCount = await database.getLikeCount({
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })
        expect(afterLikeCount).toBe(beforeLikeCount)
      })

      it('does nothing when status does not exist', async () => {
        await database.deleteLike({
          actorId: ACTOR1_ID,
          statusId: 'https://nonexistent.status/id'
        })
        // Just verifying no errors are thrown
      })
    })
  })
})
