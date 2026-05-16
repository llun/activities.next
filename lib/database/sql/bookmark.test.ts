import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('BookmarkDatabase', () => {
  const { actors, statuses } = DatabaseSeed
  const primaryActorId = actors.primary.id
  const replyAuthorId = actors.replyAuthor.id
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

    describe('createBookmark', () => {
      it('creates a private bookmark for a status', async () => {
        await database.createBookmark({
          actorId: extraActorId,
          statusId: statuses.primary.post
        })

        await expect(
          database.isActorBookmarkedStatus({
            actorId: extraActorId,
            statusId: statuses.primary.post
          })
        ).resolves.toBe(true)

        const status = await database.getStatus({
          statusId: statuses.primary.post,
          currentActorId: extraActorId
        })
        expect(status).toMatchObject({
          isActorBookmarked: true
        })
      })

      it('does not create duplicate bookmarks for the same actor and status', async () => {
        await database.createBookmark({
          actorId: replyAuthorId,
          statusId: statuses.primary.post
        })
        await database.createBookmark({
          actorId: replyAuthorId,
          statusId: statuses.primary.post
        })

        const bookmarks = await database.getBookmarks({
          actorId: replyAuthorId,
          limit: 10
        })
        const matchingBookmarks = bookmarks.filter(
          (bookmark) => bookmark.statusId === statuses.primary.post
        )
        expect(matchingBookmarks).toHaveLength(1)
      })

      it('does nothing when status does not exist', async () => {
        const missingStatusId = 'https://nonexistent.status/bookmark'

        await database.createBookmark({
          actorId: primaryActorId,
          statusId: missingStatusId
        })

        await expect(
          database.isActorBookmarkedStatus({
            actorId: primaryActorId,
            statusId: missingStatusId
          })
        ).resolves.toBe(false)
      })
    })

    describe('deleteBookmark', () => {
      it('deletes an existing bookmark', async () => {
        await database.createBookmark({
          actorId: primaryActorId,
          statusId: statuses.replyAuthor.replyToPrimary
        })

        await database.deleteBookmark({
          actorId: primaryActorId,
          statusId: statuses.replyAuthor.replyToPrimary
        })

        await expect(
          database.isActorBookmarkedStatus({
            actorId: primaryActorId,
            statusId: statuses.replyAuthor.replyToPrimary
          })
        ).resolves.toBe(false)
      })

      it('does nothing when bookmark does not exist', async () => {
        await expect(
          database.deleteBookmark({
            actorId: primaryActorId,
            statusId: statuses.poll.status
          })
        ).resolves.toBeUndefined()
      })
    })

    describe('getBookmarks', () => {
      it('returns bookmarks for the current actor only in newest-first order', async () => {
        await database.createBookmark({
          actorId: primaryActorId,
          statusId: statuses.primary.secondPost
        })
        await database.createBookmark({
          actorId: primaryActorId,
          statusId: statuses.poll.status
        })
        await database.createBookmark({
          actorId: extraActorId,
          statusId: statuses.replyAuthor.replyToPrimary
        })

        const bookmarks = await database.getBookmarks({
          actorId: primaryActorId,
          limit: 10
        })

        expect(bookmarks.map((bookmark) => bookmark.actorId)).toEqual(
          expect.arrayContaining([primaryActorId])
        )
        expect(bookmarks).not.toContainEqual(
          expect.objectContaining({ actorId: extraActorId })
        )
        expect(bookmarks.map((bookmark) => bookmark.statusId)).toEqual(
          expect.arrayContaining([
            statuses.primary.secondPost,
            statuses.poll.status
          ])
        )
      })

      it('paginates with internal bookmark ids', async () => {
        await database.createBookmark({
          actorId: replyAuthorId,
          statusId: statuses.primary.secondPost
        })
        await database.createBookmark({
          actorId: replyAuthorId,
          statusId: statuses.poll.status
        })

        const firstPage = await database.getBookmarks({
          actorId: replyAuthorId,
          limit: 1
        })
        expect(firstPage).toHaveLength(1)

        const nextPage = await database.getBookmarks({
          actorId: replyAuthorId,
          limit: 10,
          maxId: firstPage[0].id
        })

        expect(nextPage).not.toContainEqual(
          expect.objectContaining({ id: firstPage[0].id })
        )
      })
    })
  })
})
