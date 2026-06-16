import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import type { Bookmark } from '@/lib/types/domain/bookmark'
import { type Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import {
  MAX_BOOKMARK_BACKFILL_ITERATIONS,
  getBookmarkedStatusesPage
} from './getBookmarkedStatusesPage'

const readerActorId = 'https://llun.test/users/reader'
const authorActorId = 'https://llun.test/users/author'

const currentActor = {
  id: readerActorId
} as Actor

const createBookmark = (name: string, statusId: string): Bookmark => ({
  id: `bookmark-${name}`,
  actorId: readerActorId,
  statusId,
  createdAt: 0,
  updatedAt: 0
})

const createStatus = (
  name: string,
  { publicReadable = true }: { publicReadable?: boolean } = {}
) =>
  ({
    id: `https://llun.test/users/author/statuses/${name}`,
    actorId: authorActorId,
    actor: null,
    type: StatusType.enum.Note,
    to: publicReadable ? [ACTIVITY_STREAM_PUBLIC] : [],
    cc: [],
    edits: [],
    isLocalActor: false,
    createdAt: 0,
    updatedAt: 0,
    url: `https://llun.test/users/author/statuses/${name}`,
    text: name,
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: true,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: []
  }) as Status

const createDatabase = ({
  batches,
  statuses
}: {
  batches: Map<string | null, Bookmark[]>
  statuses: Status[]
}) => {
  const getBookmarks = vi.fn(
    async ({ maxId }: { maxId?: string | null }) =>
      batches.get(maxId ?? null) ?? []
  )
  const getStatusesByIds = vi.fn(
    async ({ statusIds }: { statusIds: string[] }) =>
      statuses.filter((status) => statusIds.includes(status.id))
  )
  const getAcceptedFollowTargetActorIds = vi.fn(async () => [])

  return {
    database: {
      getBookmarks,
      getStatusesByIds,
      getAcceptedFollowTargetActorIds
    } as unknown as Database,
    getBookmarks,
    getStatusesByIds,
    getAcceptedFollowTargetActorIds
  }
}

describe('getBookmarkedStatusesPage', () => {
  it('omits the next cursor when a full raw page filters empty and the next batch is exhausted', async () => {
    const hiddenOne = createStatus('hidden-one', { publicReadable: false })
    const hiddenTwo = createStatus('hidden-two', { publicReadable: false })
    const hiddenOneBookmark = createBookmark('hidden-one', hiddenOne.id)
    const hiddenTwoBookmark = createBookmark('hidden-two', hiddenTwo.id)
    const { database, getBookmarks, getStatusesByIds } = createDatabase({
      statuses: [hiddenOne, hiddenTwo],
      batches: new Map([
        [null, [hiddenOneBookmark, hiddenTwoBookmark]],
        [hiddenTwoBookmark.id, []]
      ])
    })

    const page = await getBookmarkedStatusesPage({
      database,
      actorId: readerActorId,
      currentActor,
      limit: 2
    })

    expect(page.statuses).toEqual([])
    expect(page.nextMaxBookmarkId).toBeNull()
    expect(page.prevMinBookmarkId).toBeNull()
    expect(getStatusesByIds).toHaveBeenCalledWith({
      statusIds: [hiddenOne.id, hiddenTwo.id],
      currentActorId: readerActorId,
      visibleToActorId: readerActorId,
      withReplies: false
    })
    expect(getBookmarks).toHaveBeenNthCalledWith(2, {
      actorId: readerActorId,
      limit: 2,
      maxId: hiddenTwoBookmark.id,
      minId: undefined,
      sinceId: undefined
    })
  })

  it('backfills older bookmarks when newer bookmarked statuses are unreadable', async () => {
    const hiddenOne = createStatus('hidden-one', { publicReadable: false })
    const hiddenTwo = createStatus('hidden-two', { publicReadable: false })
    const visible = createStatus('visible')
    const hiddenOneBookmark = createBookmark('hidden-one', hiddenOne.id)
    const hiddenTwoBookmark = createBookmark('hidden-two', hiddenTwo.id)
    const visibleBookmark = createBookmark('visible', visible.id)
    const { database, getBookmarks } = createDatabase({
      statuses: [hiddenOne, hiddenTwo, visible],
      batches: new Map([
        [null, [hiddenOneBookmark, hiddenTwoBookmark]],
        [hiddenTwoBookmark.id, [visibleBookmark]]
      ])
    })

    const page = await getBookmarkedStatusesPage({
      database,
      actorId: readerActorId,
      currentActor,
      limit: 2
    })

    expect(page.statuses.map((status) => status.id)).toEqual([visible.id])
    expect(page.nextMaxBookmarkId).toBeNull()
    expect(page.prevMinBookmarkId).toBe(visibleBookmark.id)
    expect(getBookmarks).toHaveBeenNthCalledWith(2, {
      actorId: readerActorId,
      limit: 2,
      maxId: hiddenTwoBookmark.id,
      minId: undefined,
      sinceId: undefined
    })
  })

  it('preserves bookmark order when status rows are returned out of order', async () => {
    const newer = createStatus('newer')
    const older = createStatus('older')
    const newerBookmark = createBookmark('newer', newer.id)
    const olderBookmark = createBookmark('older', older.id)
    const { database } = createDatabase({
      statuses: [older, newer],
      batches: new Map([[null, [newerBookmark, olderBookmark]]])
    })

    const page = await getBookmarkedStatusesPage({
      database,
      actorId: readerActorId,
      currentActor,
      limit: 2
    })

    expect(page.statuses.map((status) => status.id)).toEqual([
      newer.id,
      older.id
    ])
  })

  it('uses the last scanned bookmark cursor when the visible page is full', async () => {
    const newer = createStatus('full-newer')
    const older = createStatus('full-older')
    const newerBookmark = createBookmark('full-newer', newer.id)
    const olderBookmark = createBookmark('full-older', older.id)
    const { database } = createDatabase({
      statuses: [newer, older],
      batches: new Map([[null, [newerBookmark, olderBookmark]]])
    })

    const page = await getBookmarkedStatusesPage({
      database,
      actorId: readerActorId,
      currentActor,
      limit: 2
    })

    expect(page.nextMaxBookmarkId).toBe(olderBookmark.id)
    expect(page.prevMinBookmarkId).toBe(newerBookmark.id)
  })

  it('uses the last scanned bookmark cursor when max backfill iterations are consumed before the visible page is full', async () => {
    const limit = 3
    const visible = createStatus('max-backfill-visible')
    const visibleBookmark = createBookmark('max-backfill-visible', visible.id)
    const batches = new Map<string | null, Bookmark[]>()
    const statuses = [visible]
    let previousCursor: string | null = null
    let lastScannedBookmarkId: string | null = null

    for (
      let batchIndex = 0;
      batchIndex < MAX_BOOKMARK_BACKFILL_ITERATIONS;
      batchIndex++
    ) {
      const bookmarks = Array.from({ length: limit }, (_, bookmarkIndex) => {
        if (batchIndex === 0 && bookmarkIndex === 0) {
          return visibleBookmark
        }

        const hidden = createStatus(
          `max-backfill-hidden-${batchIndex}-${bookmarkIndex}`,
          { publicReadable: false }
        )
        statuses.push(hidden)
        return createBookmark(
          `max-backfill-hidden-${batchIndex}-${bookmarkIndex}`,
          hidden.id
        )
      })

      batches.set(previousCursor, bookmarks)
      previousCursor = bookmarks[bookmarks.length - 1].id
      lastScannedBookmarkId = previousCursor
    }

    batches.set(previousCursor, [
      createBookmark('max-backfill-unscanned', visible.id)
    ])

    const { database, getBookmarks } = createDatabase({
      statuses,
      batches
    })

    const page = await getBookmarkedStatusesPage({
      database,
      actorId: readerActorId,
      currentActor,
      limit
    })

    expect(page.statuses.map((status) => status.id)).toEqual([visible.id])
    expect(page.nextMaxBookmarkId).toBe(lastScannedBookmarkId)
    expect(page.nextMaxBookmarkId).not.toBeNull()
    expect(page.nextMaxBookmarkId).not.toBe(visibleBookmark.id)
    expect(page.prevMinBookmarkId).toBe(visibleBookmark.id)
    expect(getBookmarks).toHaveBeenCalledTimes(MAX_BOOKMARK_BACKFILL_ITERATIONS)
  })
})
