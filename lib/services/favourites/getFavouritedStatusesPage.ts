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
  const entries: Array<{ like: Like; status: Status }> = []
  let cursor = maxId ?? null
  let iterations = 0
  let lastScannedCursor: string | null = null
  let exhausted = false

  // Likes can reference statuses that are no longer readable (deleted, blocked,
  // visibility-narrowed), so backfill across a few pages to fill the requested
  // limit before giving up.
  while (
    entries.length < limit &&
    iterations < MAX_FAVOURITE_BACKFILL_ITERATIONS
  ) {
    iterations++
    const likes = await database.getLikes({
      actorId,
      limit,
      maxId: cursor,
      minId,
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
    entries.push(
      ...orderedEntries.filter((entry) =>
        readableStatusIds.has(entry.status.id)
      )
    )

    cursor = likeCursor(likes[likes.length - 1])
    lastScannedCursor = cursor

    if (likes.length < limit) {
      exhausted = true
      break
    }
  }

  const visibleEntries = entries.slice(0, limit)
  const hasBufferedVisibleEntries = entries.length > limit
  const lastVisibleCursor =
    visibleEntries.length > 0
      ? likeCursor(visibleEntries[visibleEntries.length - 1].like)
      : null
  let nextMaxFavouriteId: string | null = null

  if (
    hasBufferedVisibleEntries ||
    (visibleEntries.length === limit && !exhausted)
  ) {
    nextMaxFavouriteId = hasBufferedVisibleEntries
      ? lastVisibleCursor
      : (lastScannedCursor ?? lastVisibleCursor)
  } else if (!exhausted) {
    nextMaxFavouriteId = lastScannedCursor
  }

  return {
    statuses: visibleEntries.map((entry) => entry.status),
    nextMaxFavouriteId,
    prevMinFavouriteId:
      visibleEntries.length > 0 ? likeCursor(visibleEntries[0].like) : null
  }
}
