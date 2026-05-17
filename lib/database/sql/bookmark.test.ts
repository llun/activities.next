import { randomUUID } from 'node:crypto'

import { getOriginalStatusIdFromAnnounceContent } from '@/lib/database/sql/bookmark'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('BookmarkDatabase', () => {
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
      const secondAnnounce = await database.createAnnounce({
        id: `${ACTOR3_ID}/statuses/bookmark-nested-announce-two-${randomUUID()}`,
        actorId: ACTOR3_ID,
        originalStatusId: firstAnnounce.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

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
