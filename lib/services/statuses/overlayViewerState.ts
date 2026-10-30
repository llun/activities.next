import type { Database } from '@/lib/database/types'
import { filterReadableStatuses } from '@/lib/services/statusRouteAccess'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { StatusType } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

const overlayViewerState = <T extends StatusNote | StatusPoll>(
  live: T,
  stored: Status
): T => {
  if (
    stored.type !== StatusType.enum.Note &&
    stored.type !== StatusType.enum.Poll
  ) {
    return live
  }

  const isActorLiked = stored.isActorLiked
  // The stored count is only used when the viewer liked and the live count is
  // 0, so the heart isn't shown liked with no count; the reblog count stays live.
  const totalLikes =
    isActorLiked && (live.totalLikes ?? 0) === 0
      ? (stored.totalLikes ?? 0)
      : live.totalLikes

  return {
    ...live,
    isActorLiked,
    isActorBookmarked: stored.isActorBookmarked,
    actorAnnounceStatusId: stored.actorAnnounceStatusId,
    totalLikes,
    ...(stored.reactions && stored.reactions.length > 0
      ? { reactions: stored.reactions }
      : {})
  }
}

export const overlayStoredViewerState = async ({
  database,
  currentActor,
  statuses
}: {
  database: Database
  currentActor: Actor | null
  statuses: Status[]
}): Promise<Status[]> => {
  if (!currentActor || statuses.length === 0) return statuses

  try {
    const targetIds = statuses
      .map((status) =>
        status.type === StatusType.enum.Announce
          ? status.originalStatus?.id
          : status.id
      )
      .filter((id): id is string => Boolean(id))

    if (targetIds.length === 0) return statuses

    // Rows are looked up by the live id, so a note stored under a different
    // same-origin canonical id is not overlaid (rare).
    const storedStatuses = await database.getStatusesByIds({
      statusIds: targetIds,
      currentActorId: currentActor.id,
      withReplies: false
    })

    const readableStoredStatuses = await filterReadableStatuses({
      database,
      statuses: storedStatuses,
      currentActor
    })

    const storedMap = new Map<string, Status>()
    for (const stored of readableStoredStatuses) {
      storedMap.set(stored.id, stored)
    }

    return statuses.map((status) => {
      if (status.type === StatusType.enum.Announce) {
        const original = status.originalStatus
        const originalId = original?.id
        if (!originalId) return status
        const stored = storedMap.get(originalId)
        // Live ids are claimed by the remote outbox; verify the stored row belongs to the same actor
        if (
          !stored ||
          stored.actorId !== original.actorId ||
          (original.type !== StatusType.enum.Note &&
            original.type !== StatusType.enum.Poll)
        ) {
          return status
        }
        return {
          ...status,
          originalStatus: overlayViewerState(original, stored)
        }
      }

      if (
        status.type === StatusType.enum.Note ||
        status.type === StatusType.enum.Poll
      ) {
        const stored = storedMap.get(status.id)
        // Live ids are claimed by the remote outbox; verify the stored row belongs to the same actor
        if (!stored || stored.actorId !== status.actorId) return status
        return overlayViewerState(status, stored)
      }

      return status
    })
  } catch (error) {
    logger.error({
      message: 'Failed to overlay viewer state on live statuses',
      err: toLoggableError(error)
    })
    return statuses
  }
}
