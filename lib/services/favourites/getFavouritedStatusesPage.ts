import { encodeFavouriteCursor } from '@/lib/database/sql/utils/favouriteCursor'
import type { Database } from '@/lib/database/types'
import { filterReadableStatuses } from '@/lib/services/statusRouteAccess'
import type { Like } from '@/lib/types/database/operations'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'

export const MAX_FAVOURITE_BACKFILL_ITERATIONS = 5

interface GetFavouritedStatusesPageParams {
  database: Database
  actorId: string
  currentActor: Actor
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

interface FavouritedStatusesPage {
  statuses: Status[]
  nextMaxFavouriteId: string | null
  prevMinFavouriteId: string | null
}

const likeCursor = (like: Like): string =>
  encodeFavouriteCursor({ createdAt: like.createdAt, statusId: like.statusId })

export const getFavouritedStatusesPage = async ({
  database,
  actorId,
  currentActor,
  limit,
  maxId,
  minId,
  sinceId
}: GetFavouritedStatusesPageParams): Promise<FavouritedStatusesPage> => {
  // `min_id` requests forward (immediately-newer) pagination; every other cursor
  // (max_id, since_id, none) pages newest-first. The bound we advance between
  // backfill iterations depends on that direction.
  const forward = Boolean(minId)
  const collected: Array<{ like: Like; status: Status }> = []
  let currentMaxId = maxId ?? null
  let currentMinId = minId ?? null
  let iterations = 0
  let exhausted = false

  // Likes can reference statuses that are no longer readable (deleted, blocked,
  // visibility-narrowed), so backfill across a few pages to fill the requested
  // limit before giving up.
  while (
    collected.length < limit &&
    iterations < MAX_FAVOURITE_BACKFILL_ITERATIONS
  ) {
    iterations++
    const likes = await database.getLikes({
      actorId,
      limit,
      maxId: currentMaxId,
      minId: currentMinId,
      sinceId
    })
    if (likes.length === 0) {
      exhausted = true
      break
    }

    const statuses = await database.getStatusesByIds({
      statusIds: likes.map((like) => like.statusId),
      currentActorId: actorId,
      visibleToActorId: currentActor.id,
      withReplies: false
    })
    const statusMap = new Map<string, Status>(
      statuses.map((status) => [status.id, status])
    )
    const orderedEntries = likes
      .map((like) => {
        const status = statusMap.get(like.statusId)
        return status ? { like, status } : null
      })
      .filter((entry): entry is { like: Like; status: Status } =>
        Boolean(entry)
      )
    const readableStatuses = await filterReadableStatuses({
      database,
      statuses: orderedEntries.map((entry) => entry.status),
      currentActor
    })
    const readableStatusIds = new Set(
      readableStatuses.map((status) => status.id)
    )
    collected.push(
      ...orderedEntries.filter((entry) =>
        readableStatusIds.has(entry.status.id)
      )
    )

    // getLikes returns rows newest-first: likes[0] is the newest scanned,
    // likes[last] the oldest. Advancing the matching bound keeps the next
    // iteration over a fresh range instead of re-scanning the same band.
    if (forward) {
      currentMinId = likeCursor(likes[0])
    } else {
      currentMaxId = likeCursor(likes[likes.length - 1])
    }

    if (likes.length < limit) {
      exhausted = true
      break
    }
  }

  // Forward backfill scans bands moving away from `min_id`, so re-select the
  // favourites closest to the cursor and present them newest-first. The
  // descending paths are already globally newest-first.
  const visibleEntries = forward
    ? [...collected]
        .sort(
          (a, b) =>
            a.like.createdAt - b.like.createdAt ||
            (a.like.statusId < b.like.statusId
              ? -1
              : a.like.statusId > b.like.statusId
                ? 1
                : 0)
        )
        .slice(0, limit)
        .reverse()
    : collected.slice(0, limit)

  const newestCursor =
    visibleEntries.length > 0 ? likeCursor(visibleEntries[0].like) : null
  const oldestCursor =
    visibleEntries.length > 0
      ? likeCursor(visibleEntries[visibleEntries.length - 1].like)
      : null

  // When more likes remain past the scanned window we must still hand back a
  // resume cursor, even if this page produced no visible (readable) entries —
  // otherwise a run of >= MAX_FAVOURITE_BACKFILL_ITERATIONS * limit unreadable
  // likes returns an empty page with no Link header and the client dead-ends,
  // stranding readable favourites beyond it. Resume from where the scan
  // actually stopped (`currentMax/MinId`) so progress is guaranteed; only fall
  // back to the visible bound when extra readable entries were buffered.
  const buffered = collected.length > limit
  const nextMaxFavouriteId = forward
    ? oldestCursor
    : buffered
      ? oldestCursor
      : exhausted
        ? null
        : (currentMaxId ?? oldestCursor)
  const prevMinFavouriteId =
    forward && !buffered && !exhausted
      ? (currentMinId ?? newestCursor)
      : newestCursor

  return {
    statuses: visibleEntries.map((entry) => entry.status),
    nextMaxFavouriteId,
    prevMinFavouriteId
  }
}
