import { randomUUID } from 'node:crypto'

import {
  bookmarkQueries,
  getOriginalStatusIdFromAnnounceContent
} from '@/lib/database/domains/bookmark/queries'
import {
  type TestDatabaseTable,
  databaseBeforeAll
} from '@/lib/database/testUtils'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { withStaleFirstRead } from '@/lib/database/testing/staleRead'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('BookmarkDatabase', () => {
  const testDb = createTestDatabase()
  const table: TestDatabaseTable = [
    [testDb.backend, testDb.database, testDb.prepare]
  ]

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

    const createStatus = async (name: string, actorId = ACTOR1_ID) => {
      const statusId = `${actorId}/statuses/bookmark-${name}-${randomUUID()}`
      return database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        text: `Bookmark ${name}`,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
    }

    it('creates bookmarks idempotently for an actor and status', async () => {
      const status = await createStatus('idempotent')

      await database.createBookmark({ actorId: ACTOR2_ID, statusId: status.id })
      await database.createBookmark({ actorId: ACTOR2_ID, statusId: status.id })

      await expect(
        database.isActorBookmarkedStatus({
          actorId: ACTOR2_ID,
          statusId: status.id
        })
      ).resolves.toBe(true)

      const bookmarks = await database.getBookmarks({
        actorId: ACTOR2_ID,
        limit: 20
      })
      expect(
        bookmarks.filter((bookmark) => bookmark.statusId === status.id)
      ).toHaveLength(1)
    })

    it('deletes bookmarks idempotently', async () => {
      const status = await createStatus('delete')
      await database.createBookmark({ actorId: ACTOR2_ID, statusId: status.id })

      await database.deleteBookmark({ actorId: ACTOR2_ID, statusId: status.id })
      await database.deleteBookmark({ actorId: ACTOR2_ID, statusId: status.id })

      await expect(
        database.isActorBookmarkedStatus({
          actorId: ACTOR2_ID,
          statusId: status.id
        })
      ).resolves.toBe(false)
    })

    it('normalizes announce bookmarks to the original status', async () => {
      const original = await createStatus('announce-original', ACTOR1_ID)
      const announce = await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/bookmark-announce-${randomUUID()}`,
        actorId: ACTOR2_ID,
        originalStatusId: original.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      if (!announce) throw new Error('announce must not be null')

      await database.createBookmark({
        actorId: ACTOR3_ID,
        statusId: announce.id
      })

      await expect(
        database.isActorBookmarkedStatus({
          actorId: ACTOR3_ID,
          statusId: original.id
        })
      ).resolves.toBe(true)
      await expect(
        database.isActorBookmarkedStatus({
          actorId: ACTOR3_ID,
          statusId: announce.id
        })
      ).resolves.toBe(true)

      const bookmarks = await database.getBookmarks({
        actorId: ACTOR3_ID,
        limit: 20
      })
      expect(
        bookmarks.filter((bookmark) => bookmark.statusId === original.id)
      ).toHaveLength(1)
      expect(
        bookmarks.filter((bookmark) => bookmark.statusId === announce.id)
      ).toHaveLength(0)
    })

    it('normalizes nested announce bookmarks to the root original status', async () => {
      const original = await createStatus('nested-announce-original', ACTOR1_ID)
      const firstAnnounce = await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/bookmark-nested-announce-one-${randomUUID()}`,
        actorId: ACTOR2_ID,
        originalStatusId: original.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      if (!firstAnnounce) throw new Error('firstAnnounce must not be null')
      const secondAnnounce = await database.createAnnounce({
        id: `${ACTOR3_ID}/statuses/bookmark-nested-announce-two-${randomUUID()}`,
        actorId: ACTOR3_ID,
        originalStatusId: firstAnnounce.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      if (!secondAnnounce) throw new Error('secondAnnounce must not be null')

      await database.createBookmark({
        actorId: ACTOR2_ID,
        statusId: secondAnnounce.id
      })

      await expect(
        database.isActorBookmarkedStatus({
          actorId: ACTOR2_ID,
          statusId: original.id
        })
      ).resolves.toBe(true)
      await expect(
        database.isActorBookmarkedStatus({
          actorId: ACTOR2_ID,
          statusId: firstAnnounce.id
        })
      ).resolves.toBe(true)
      await expect(
        database.isActorBookmarkedStatus({
          actorId: ACTOR2_ID,
          statusId: secondAnnounce.id
        })
      ).resolves.toBe(true)

      const bookmarks = await database.getBookmarks({
        actorId: ACTOR2_ID,
        limit: 20
      })
      expect(
        bookmarks.filter((bookmark) => bookmark.statusId === original.id)
      ).toHaveLength(1)
      expect(
        bookmarks.filter((bookmark) => bookmark.statusId === firstAnnounce.id)
      ).toHaveLength(0)
      expect(
        bookmarks.filter((bookmark) => bookmark.statusId === secondAnnounce.id)
      ).toHaveLength(0)
    })

    it('resolves and deletes bookmarks created through an Announce after the Announce row is deleted', async () => {
      const original = await createStatus(
        'deleted-announce-original',
        ACTOR1_ID
      )
      const announce = await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/bookmark-deleted-announce-${randomUUID()}`,
        actorId: ACTOR2_ID,
        originalStatusId: original.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      if (!announce) throw new Error('announce must not be null')

      await database.createBookmark({
        actorId: ACTOR3_ID,
        statusId: announce.id
      })
      await database.deleteStatus({ statusId: announce.id })

      const bookmarks = await database.getBookmarks({
        actorId: ACTOR3_ID,
        limit: 20
      })
      expect(
        bookmarks.filter((bookmark) => bookmark.statusId === original.id)
      ).toHaveLength(1)
      expect(
        bookmarks.filter((bookmark) => bookmark.statusId === announce.id)
      ).toHaveLength(0)

      await expect(
        database.isActorBookmarkedStatus({
          actorId: ACTOR3_ID,
          statusId: announce.id,
          statusType: StatusType.enum.Announce
        })
      ).resolves.toBe(true)

      await database.deleteBookmark({
        actorId: ACTOR3_ID,
        statusId: announce.id
      })

      await expect(
        database.isActorBookmarkedStatus({
          actorId: ACTOR3_ID,
          statusId: original.id
        })
      ).resolves.toBe(false)
    })

    it('paginates bookmarks by private bookmark ids', async () => {
      const actorId = `${ACTOR3_ID}/bookmark-pagination-${randomUUID()}`
      const statuses = await Promise.all([
        createStatus('pagination-1'),
        createStatus('pagination-2'),
        createStatus('pagination-3')
      ])
      for (const status of statuses) {
        await database.createBookmark({ actorId, statusId: status.id })
      }

      const firstPage = await database.getBookmarks({ actorId, limit: 2 })
      expect(firstPage).toHaveLength(2)

      const secondPage = await database.getBookmarks({
        actorId,
        limit: 2,
        maxId: firstPage[firstPage.length - 1].id
      })

      expect(secondPage).toHaveLength(1)
      expect(secondPage.map((bookmark) => bookmark.id)).not.toContain(
        firstPage[0].id
      )
      expect(secondPage.map((bookmark) => bookmark.id)).not.toContain(
        firstPage[1].id
      )
    })

    it('applies max_id and min_id as a bounded bookmark window', async () => {
      const actorId = `${ACTOR3_ID}/bookmark-window-${randomUUID()}`
      const statuses = await Promise.all([
        createStatus('window-1'),
        createStatus('window-2'),
        createStatus('window-3'),
        createStatus('window-4'),
        createStatus('window-5')
      ])
      for (const status of statuses) {
        await database.createBookmark({ actorId, statusId: status.id })
      }

      const allBookmarks = await database.getBookmarks({ actorId, limit: 10 })
      expect(allBookmarks).toHaveLength(5)

      const boundedBookmarks = await database.getBookmarks({
        actorId,
        limit: 10,
        maxId: allBookmarks[0].id,
        minId: allBookmarks[3].id
      })

      expect(boundedBookmarks.map((bookmark) => bookmark.id)).toEqual([
        allBookmarks[1].id,
        allBookmarks[2].id
      ])
    })

    it('applies max_id and since_id as a bounded bookmark window', async () => {
      const actorId = `${ACTOR3_ID}/bookmark-since-window-${randomUUID()}`
      const statuses = await Promise.all([
        createStatus('since-window-1'),
        createStatus('since-window-2'),
        createStatus('since-window-3'),
        createStatus('since-window-4'),
        createStatus('since-window-5')
      ])
      for (const status of statuses) {
        await database.createBookmark({ actorId, statusId: status.id })
      }

      const allBookmarks = await database.getBookmarks({ actorId, limit: 10 })
      expect(allBookmarks).toHaveLength(5)

      const boundedBookmarks = await database.getBookmarks({
        actorId,
        limit: 10,
        maxId: allBookmarks[0].id,
        sinceId: allBookmarks[3].id
      })

      expect(boundedBookmarks.map((bookmark) => bookmark.id)).toEqual([
        allBookmarks[1].id,
        allBookmarks[2].id
      ])
    })

    it('returns min_id pages in descending bookmark order', async () => {
      const actorId = `${ACTOR3_ID}/bookmark-min-order-${randomUUID()}`
      const statuses = await Promise.all([
        createStatus('min-order-1'),
        createStatus('min-order-2'),
        createStatus('min-order-3'),
        createStatus('min-order-4'),
        createStatus('min-order-5')
      ])
      for (const status of statuses) {
        await database.createBookmark({ actorId, statusId: status.id })
      }

      const allBookmarks = await database.getBookmarks({ actorId, limit: 10 })
      const newerBookmarks = await database.getBookmarks({
        actorId,
        limit: 2,
        minId: allBookmarks[4].id
      })

      expect(newerBookmarks.map((bookmark) => bookmark.id)).toEqual([
        allBookmarks[2].id,
        allBookmarks[3].id
      ])
    })

    it('returns no bookmarks for invalid pagination cursors', async () => {
      const actorId = `${ACTOR3_ID}/bookmark-invalid-cursor-${randomUUID()}`
      const status = await createStatus('invalid-cursor')
      await database.createBookmark({ actorId, statusId: status.id })

      await expect(
        database.getBookmarks({ actorId, limit: 20, maxId: 'not-a-number' })
      ).resolves.toEqual([])
      await expect(
        database.getBookmarks({ actorId, limit: 20, minId: 'not-a-number' })
      ).resolves.toEqual([])
      await expect(
        database.getBookmarks({ actorId, limit: 20, sinceId: 'not-a-number' })
      ).resolves.toEqual([])
      // Digit strings past Number.MAX_SAFE_INTEGER name no bookmark: the
      // int8 maximum some clients send as "no upper bound", and one past it.
      for (const cursor of ['9223372036854775807', '99999999999999999999']) {
        for (const key of ['maxId', 'minId', 'sinceId'] as const) {
          await expect(
            database.getBookmarks({ actorId, limit: 20, [key]: cursor })
          ).resolves.toEqual([])
        }
      }
    })

    it('removes bookmarks when a bookmarked status is deleted', async () => {
      const status = await createStatus('status-delete')
      await database.createBookmark({ actorId: ACTOR2_ID, statusId: status.id })

      await database.deleteStatus({ statusId: status.id })

      await expect(
        database.isActorBookmarkedStatus({
          actorId: ACTOR2_ID,
          statusId: status.id
        })
      ).resolves.toBe(false)
    })

    describe('bookmarks of different actors and statuses', () => {
      const actorOf = (name: string) =>
        `${ACTOR3_ID}/bookmark-${name}-${randomUUID()}`

      const createAnnounceOf = async (originalId: string, name: string) => {
        const announce = await database.createAnnounce({
          id: `${ACTOR2_ID}/statuses/bookmark-${name}-${randomUUID()}`,
          actorId: ACTOR2_ID,
          originalStatusId: originalId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        if (!announce) throw new Error('announce must not be null')
        return announce
      }

      const storedSources = async (statusId: string) =>
        Object.fromEntries(
          (
            await testDb
              .knex('bookmarks')
              .where({ statusId })
              .select('actorId', 'sourceStatusId')
          ).map((row) => [row.actorId, row.sourceStatusId])
        )

      it('lets every actor bookmark the same status', async () => {
        const status = await createStatus('shared')
        const first = actorOf('shared-first')
        const second = actorOf('shared-second')

        await database.createBookmark({ actorId: first, statusId: status.id })
        await database.createBookmark({ actorId: second, statusId: status.id })

        for (const actorId of [first, second]) {
          const bookmarks = await database.getBookmarks({ actorId, limit: 20 })
          expect(bookmarks.map((bookmark) => bookmark.statusId)).toEqual([
            status.id
          ])
          expect(bookmarks[0].actorId).toBe(actorId)
        }
      })

      it('reports a bookmark only for the actor and status it belongs to', async () => {
        const bookmarked = await createStatus('is-bookmarked')
        const other = await createStatus('is-other')
        const owner = actorOf('is-owner')
        const stranger = actorOf('is-stranger')
        await database.createBookmark({
          actorId: owner,
          statusId: bookmarked.id
        })

        await expect(
          database.isActorBookmarkedStatus({
            actorId: owner,
            statusId: bookmarked.id
          })
        ).resolves.toBe(true)
        await expect(
          database.isActorBookmarkedStatus({
            actorId: stranger,
            statusId: bookmarked.id
          })
        ).resolves.toBe(false)
        await expect(
          database.isActorBookmarkedStatus({
            actorId: owner,
            statusId: other.id
          })
        ).resolves.toBe(false)
      })

      it('reports a bookmark made through an announce only for its owner', async () => {
        const original = await createStatus('is-announce-original')
        const announce = await createAnnounceOf(original.id, 'is-announce')
        const owner = actorOf('is-announce-owner')
        const stranger = actorOf('is-announce-stranger')
        await database.createBookmark({ actorId: owner, statusId: announce.id })

        await expect(
          database.isActorBookmarkedStatus({
            actorId: stranger,
            statusId: announce.id,
            statusType: StatusType.enum.Announce
          })
        ).resolves.toBe(false)
        await expect(
          database.isActorBookmarkedStatus({
            actorId: owner,
            statusId: announce.id,
            statusType: StatusType.enum.Announce
          })
        ).resolves.toBe(true)
      })

      it('deletes only the bookmark of the actor and status asked for', async () => {
        const target = await createStatus('delete-target')
        const kept = await createStatus('delete-kept')
        const owner = actorOf('delete-owner')
        const other = actorOf('delete-other')
        await database.createBookmark({ actorId: owner, statusId: kept.id })
        await database.createBookmark({ actorId: other, statusId: target.id })
        await database.createBookmark({ actorId: owner, statusId: target.id })

        await database.deleteBookmark({
          actorId: owner,
          statusId: target.id
        })

        const isBookmarked = (actorId: string, statusId: string) =>
          database.isActorBookmarkedStatus({ actorId, statusId })
        await expect(isBookmarked(owner, target.id)).resolves.toBe(false)
        await expect(isBookmarked(owner, kept.id)).resolves.toBe(true)
        await expect(isBookmarked(other, target.id)).resolves.toBe(true)
      })

      it('deleting through an announce leaves other actors and statuses alone', async () => {
        const original = await createStatus('delete-announce-original')
        const announce = await createAnnounceOf(original.id, 'delete-announce')
        const kept = await createStatus('delete-announce-kept')
        const owner = actorOf('delete-announce-owner')
        const other = actorOf('delete-announce-other')
        await database.createBookmark({ actorId: owner, statusId: kept.id })
        await database.createBookmark({
          actorId: other,
          statusId: announce.id
        })
        await database.createBookmark({
          actorId: owner,
          statusId: announce.id
        })

        await database.deleteBookmark({
          actorId: owner,
          statusId: announce.id
        })

        const isBookmarked = (actorId: string, statusId: string) =>
          database.isActorBookmarkedStatus({ actorId, statusId })
        await expect(isBookmarked(owner, original.id)).resolves.toBe(false)
        await expect(isBookmarked(owner, kept.id)).resolves.toBe(true)
        await expect(isBookmarked(other, original.id)).resolves.toBe(true)
      })

      it('deletes a bookmark made through one announce through another announce of the same status', async () => {
        const original = await createStatus('delete-sibling-original')
        const first = await createAnnounceOf(original.id, 'delete-sibling-1')
        const second = await createAnnounceOf(original.id, 'delete-sibling-2')
        const owner = actorOf('delete-sibling-owner')
        await database.createBookmark({ actorId: owner, statusId: first.id })

        // Neither the stored status (the original) nor the stored source (the
        // first announce) is the second announce: only resolving it finds them.
        await database.deleteBookmark({ actorId: owner, statusId: second.id })

        await expect(
          database.isActorBookmarkedStatus({
            actorId: owner,
            statusId: original.id
          })
        ).resolves.toBe(false)
      })

      it('resolves an announce stored without originalStatusId through its content', async () => {
        const original = await createStatus('legacy-original')
        const owner = actorOf('legacy-owner')
        // A row written before originalStatusId existed: the announced id is
        // only in the content.
        const legacyAnnounceId = `${ACTOR2_ID}/statuses/bookmark-legacy-${randomUUID()}`
        await testDb.knex('statuses').insert({
          id: legacyAnnounceId,
          actorId: ACTOR2_ID,
          type: StatusType.enum.Announce,
          content: original.id,
          originalStatusId: null
        })

        await database.createBookmark({
          actorId: owner,
          statusId: legacyAnnounceId
        })

        await expect(storedSources(original.id)).resolves.toEqual({
          [owner]: legacyAnnounceId
        })
      })

      it('records the announce a bookmark was made through on that bookmark only', async () => {
        const original = await createStatus('source-original')
        const firstAnnounce = await createAnnounceOf(original.id, 'source-one')
        const secondAnnounce = await createAnnounceOf(original.id, 'source-two')
        const mover = actorOf('source-mover')
        const bystander = actorOf('source-bystander')
        const unrelated = actorOf('source-unrelated')
        const plain = await createStatus('source-plain')
        await database.createBookmark({
          actorId: unrelated,
          statusId: plain.id
        })
        await database.createBookmark({
          actorId: bystander,
          statusId: firstAnnounce.id
        })
        await database.createBookmark({
          actorId: mover,
          statusId: firstAnnounce.id
        })

        await database.createBookmark({
          actorId: mover,
          statusId: secondAnnounce.id
        })

        await expect(storedSources(original.id)).resolves.toEqual({
          [mover]: secondAnnounce.id,
          [bystander]: firstAnnounce.id
        })
        await expect(storedSources(plain.id)).resolves.toEqual({
          [unrelated]: null
        })
      })

      it('stays idempotent when a concurrent request bookmarks the status first', async () => {
        const status = await createStatus('concurrent')
        const actorId = actorOf('concurrent')
        await database.createBookmark({ actorId, statusId: status.id })

        // The existing bookmark is not seen by the check, as if the other
        // request inserted it after the check ran.
        const racing = withStaleFirstRead(testDb.db, 'bookmarks', () => [])
        await expect(
          bookmarkQueries.createBookmark(racing, {
            actorId,
            statusId: status.id
          })
        ).resolves.toBeUndefined()

        await expect(
          database.getBookmarks({ actorId, limit: 20 })
        ).resolves.toHaveLength(1)
      })

      it('orders bookmarks by creation time, then by id', async () => {
        const actorId = actorOf('ordering')
        const statuses = await Promise.all(
          [1, 2, 3, 4].map((index) => createStatus(`ordering-${index}`))
        )
        // Written in this order, so ids ascend 0..3 while createdAt does not:
        // 0 and 2 share a timestamp, 1 is the oldest and 3 the newest.
        const createdAts = [2_000, 1_000, 2_000, 3_000]
        for (const [index, status] of statuses.entries()) {
          await testDb.knex('bookmarks').insert({
            actorId,
            statusId: status.id,
            createdAt: new Date(createdAts[index]),
            updatedAt: new Date(createdAts[index])
          })
        }
        const byStatus = (bookmarks: { statusId: string }[]) =>
          bookmarks.map((bookmark) =>
            statuses.findIndex((status) => status.id === bookmark.statusId)
          )

        const newestFirst = await database.getBookmarks({ actorId, limit: 10 })
        expect(byStatus(newestFirst)).toEqual([3, 2, 0, 1])

        const olderThanTie = await database.getBookmarks({
          actorId,
          limit: 10,
          maxId: newestFirst[1].id
        })
        expect(byStatus(olderThanTie)).toEqual([0, 1])

        const newerThanTie = await database.getBookmarks({
          actorId,
          limit: 10,
          minId: newestFirst[2].id
        })
        expect(byStatus(newerThanTie)).toEqual([3, 2])

        const afterOldest = await database.getBookmarks({
          actorId,
          limit: 2,
          minId: newestFirst[3].id
        })
        expect(byStatus(afterOldest)).toEqual([2, 0])
      })

      it('ignores a pagination cursor that belongs to another actor', async () => {
        const status = await createStatus('foreign-cursor')
        const owner = actorOf('foreign-cursor-owner')
        const reader = actorOf('foreign-cursor-reader')
        await database.createBookmark({ actorId: owner, statusId: status.id })
        await database.createBookmark({ actorId: reader, statusId: status.id })
        const [foreign] = await database.getBookmarks({
          actorId: owner,
          limit: 20
        })

        for (const cursor of [
          { maxId: foreign.id },
          { minId: foreign.id },
          { sinceId: foreign.id }
        ]) {
          await expect(
            database.getBookmarks({ actorId: reader, limit: 20, ...cursor })
          ).resolves.toEqual([])
        }
      })

      it('pages only through the bookmarks of the actor asked for', async () => {
        const statuses = await Promise.all([
          createStatus('scoped-1'),
          createStatus('scoped-2'),
          createStatus('scoped-3')
        ])
        const reader = actorOf('scoped-reader')
        const neighbour = actorOf('scoped-neighbour')
        for (const status of statuses) {
          await database.createBookmark({
            actorId: reader,
            statusId: status.id
          })
          await database.createBookmark({
            actorId: neighbour,
            statusId: status.id
          })
        }

        const all = await database.getBookmarks({ actorId: reader, limit: 20 })
        expect(all).toHaveLength(3)
        expect(all.every((bookmark) => bookmark.actorId === reader)).toBe(true)
        const older = await database.getBookmarks({
          actorId: reader,
          limit: 20,
          maxId: all[0].id
        })
        expect(older.map((bookmark) => bookmark.id)).toEqual([
          all[1].id,
          all[2].id
        ])
        const newer = await database.getBookmarks({
          actorId: reader,
          limit: 20,
          sinceId: all[2].id
        })
        expect(newer.map((bookmark) => bookmark.id)).toEqual([
          all[0].id,
          all[1].id
        ])
        const limited = await database.getBookmarks({
          actorId: reader,
          limit: 1
        })
        expect(limited).toHaveLength(1)
      })
    })
  })
})

describe('getOriginalStatusIdFromAnnounceContent', () => {
  it('extracts original status ids from legacy announce content shapes', () => {
    expect(getOriginalStatusIdFromAnnounceContent('original-plain')).toBe(
      'original-plain'
    )
    expect(
      getOriginalStatusIdFromAnnounceContent(JSON.stringify('original-json'))
    ).toBe('original-json')
    expect(
      getOriginalStatusIdFromAnnounceContent(
        JSON.stringify({ url: 'original-url' })
      )
    ).toBe('original-url')
    expect(
      getOriginalStatusIdFromAnnounceContent(
        JSON.stringify({ id: 'original-id' })
      )
    ).toBe('original-id')
    expect(
      getOriginalStatusIdFromAnnounceContent({ url: 'original-object-url' })
    ).toBe('original-object-url')
    expect(
      getOriginalStatusIdFromAnnounceContent({ id: 'original-object-id' })
    ).toBe('original-object-id')
  })
})
