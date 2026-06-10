import { encodeFavouriteCursor } from '@/lib/database/sql/utils/favouriteCursor'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { Like } from '@/lib/types/database/operations'

describe('LikeDatabase', () => {
  const { actors, statuses } = DatabaseSeed
  const primaryActorId = actors.primary.id
  const replyAuthorId = actors.replyAuthor.id
  const pollAuthorId = actors.pollAuthor.id
  const extraActorId = actors.extra.id
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
          actorId: replyAuthorId,
          statusId: statuses.poll.status
        })
        expect(isLiked).toBeTrue()
      })

      it('returns false if actor has not liked the status', async () => {
        const isLiked = await database.isActorLikedStatus({
          actorId: primaryActorId,
          statusId: statuses.poll.status
        })
        expect(isLiked).toBeFalse()
      })

      it('returns false if status does not exist', async () => {
        const isLiked = await database.isActorLikedStatus({
          actorId: primaryActorId,
          statusId: 'https://nonexistent.status/id'
        })
        expect(isLiked).toBeFalse()
      })
    })

    describe('getLikeCount', () => {
      it('returns correct count for a liked status', async () => {
        const count = await database.getLikeCount({
          statusId: statuses.poll.status
        })
        expect(count).toBe(1)
      })

      it('returns zero for a status with no likes', async () => {
        const count = await database.getLikeCount({
          statusId: statuses.primary.post
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
          statusId: statuses.primary.post
        })
        const beforeIsLiked = await database.isActorLikedStatus({
          actorId: extraActorId,
          statusId: statuses.primary.post
        })
        expect(beforeLikeCount).toBe(0)
        expect(beforeIsLiked).toBeFalse()

        // Create the like
        await database.createLike({
          actorId: extraActorId,
          statusId: statuses.primary.post
        })

        // Verify like was created
        const afterLikeCount = await database.getLikeCount({
          statusId: statuses.primary.post
        })
        const afterIsLiked = await database.isActorLikedStatus({
          actorId: extraActorId,
          statusId: statuses.primary.post
        })
        expect(afterLikeCount).toBe(1)
        expect(afterIsLiked).toBeTrue()

        // Verify reflected in status object
        const status = await database.getStatus({
          statusId: statuses.primary.post,
          currentActorId: extraActorId
        })
        expect(status).toMatchObject({
          isActorLiked: true,
          totalLikes: 1
        })
      })

      it('does not create duplicate likes for the same actor and status', async () => {
        // Create the like
        await database.createLike({
          actorId: extraActorId,
          statusId: statuses.primary.post
        })

        // Create the same like again
        await database.createLike({
          actorId: extraActorId,
          statusId: statuses.primary.post
        })

        // Verify count is still 1
        const likeCount = await database.getLikeCount({
          statusId: statuses.primary.post
        })
        expect(likeCount).toBe(1)
      })

      it('does nothing when status does not exist', async () => {
        await database.createLike({
          actorId: primaryActorId,
          statusId: 'https://nonexistent.status/id'
        })

        const isLiked = await database.isActorLikedStatus({
          actorId: primaryActorId,
          statusId: 'https://nonexistent.status/id'
        })
        expect(isLiked).toBeFalse()
      })
    })

    describe('deleteLike', () => {
      it('deletes an existing like', async () => {
        // Create a like first
        await database.createLike({
          actorId: primaryActorId,
          statusId: statuses.poll.status
        })

        // Verify like exists
        const beforeIsLiked = await database.isActorLikedStatus({
          actorId: primaryActorId,
          statusId: statuses.poll.status
        })
        const beforeLikeCount = await database.getLikeCount({
          statusId: statuses.poll.status
        })
        expect(beforeIsLiked).toBeTrue()
        expect(beforeLikeCount).toBe(2) // Original like + the one we just created

        // Delete the like
        await database.deleteLike({
          actorId: primaryActorId,
          statusId: statuses.poll.status
        })

        // Verify like is deleted
        const afterIsLiked = await database.isActorLikedStatus({
          actorId: primaryActorId,
          statusId: statuses.poll.status
        })
        const afterLikeCount = await database.getLikeCount({
          statusId: statuses.poll.status
        })
        expect(afterIsLiked).toBeFalse()
        expect(afterLikeCount).toBe(1) // Back to just the original like

        // Verify reflected in status object
        const status = await database.getStatus({
          statusId: statuses.poll.status,
          currentActorId: primaryActorId
        })
        expect(status).toMatchObject({
          isActorLiked: false,
          totalLikes: 1
        })
      })

      it('does nothing when the like does not exist', async () => {
        // Check initial state
        const beforeLikeCount = await database.getLikeCount({
          statusId: statuses.primary.post
        })

        // Delete a nonexistent like
        await database.deleteLike({
          actorId: pollAuthorId,
          statusId: statuses.primary.post
        })

        // Verify count is unchanged
        const afterLikeCount = await database.getLikeCount({
          statusId: statuses.primary.post
        })
        expect(afterLikeCount).toBe(beforeLikeCount)
      })

      it('does nothing when status does not exist', async () => {
        await expect(
          database.deleteLike({
            actorId: primaryActorId,
            statusId: 'https://nonexistent.status/id'
          })
        ).resolves.toBeUndefined()
      })
    })

    describe('getLikes', () => {
      // `actors.empty` has no seeded likes, so this block is isolated from the
      // mutations performed by the create/delete suites above.
      const favouriteActorId = actors.empty.id
      const likedStatuses = [
        statuses.primary.post,
        statuses.primary.secondPost,
        statuses.primary.postWithAttachments,
        statuses.replyAuthor.replyToPrimary
      ]

      beforeAll(async () => {
        for (const statusId of likedStatuses) {
          await database.createLike({ actorId: favouriteActorId, statusId })
        }
      })

      const cursorFor = (like: Like) =>
        encodeFavouriteCursor({
          createdAt: like.createdAt,
          statusId: like.statusId
        })

      it('returns every favourite for the actor', async () => {
        const likes = await database.getLikes({
          actorId: favouriteActorId,
          limit: 20
        })
        expect(likes.map((like) => like.statusId).sort()).toEqual(
          [...likedStatuses].sort()
        )
        likes.forEach((like) => {
          expect(like.actorId).toEqual(favouriteActorId)
          expect(typeof like.createdAt).toBe('number')
        })
      })

      it('paginates with max_id without gaps or duplicates', async () => {
        const collectedIds: string[] = []
        let cursor: string | null = null
        for (let page = 0; page < likedStatuses.length + 1; page++) {
          const likes: Like[] = await database.getLikes({
            actorId: favouriteActorId,
            limit: 2,
            maxId: cursor
          })
          if (likes.length === 0) break
          collectedIds.push(...likes.map((like) => like.statusId))
          cursor = cursorFor(likes[likes.length - 1])
          if (likes.length < 2) break
        }
        expect(new Set(collectedIds).size).toBe(likedStatuses.length)
        expect(collectedIds.sort()).toEqual([...likedStatuses].sort())
      })

      it('returns an empty page for a malformed cursor', async () => {
        const likes = await database.getLikes({
          actorId: favouriteActorId,
          limit: 10,
          maxId: '@@@'
        })
        expect(likes).toEqual([])
      })

      it('returns only newer favourites with min_id', async () => {
        const all = await database.getLikes({
          actorId: favouriteActorId,
          limit: 20
        })
        const oldest = all[all.length - 1]
        const newer = await database.getLikes({
          actorId: favouriteActorId,
          limit: 20,
          minId: cursorFor(oldest)
        })
        expect(newer.map((like) => like.statusId)).not.toContain(
          oldest.statusId
        )
        expect(newer).toHaveLength(all.length - 1)
      })
    })
  })
})
