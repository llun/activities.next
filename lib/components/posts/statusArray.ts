import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'

export type StatusTarget = string | { id: string }

/**
 * Apply an update patch to matching statuses by original status id, reaching
 * inside Announce wrappers to update the wrapped original status as well.
 * Untouched rows and untouched arrays preserve their exact references.
 */
export const updateMatchingStatus = (
  statuses: Status[],
  targetId: string,
  patch: (target: StatusNote | StatusPoll) => StatusNote | StatusPoll
): Status[] => {
  let hasChanges = false
  const updated = statuses.map((item) => {
    if (item.type === StatusType.enum.Announce) {
      const original = item.originalStatus
      // Boosts wrap a Note/Poll; nested boosts aren't an interactive target.
      if (
        original.type !== StatusType.enum.Announce &&
        original.id === targetId
      ) {
        hasChanges = true
        return { ...item, originalStatus: patch(original) }
      }
      return item
    }
    if (item.id === targetId) {
      hasChanges = true
      return patch(item)
    }
    return item
  })
  return hasChanges ? updated : statuses
}

/**
 * Remove matching statuses by original status identity (either by direct status
 * id or by original status id wrapped in an Announce).
 * Untouched rows and untouched arrays preserve their exact references.
 */
export const removeOriginalStatus = (
  statuses: Status[],
  target: StatusTarget
): Status[] => {
  const targetId = typeof target === 'string' ? target : target.id
  let hasRemoval = false
  const updated = statuses.filter((item) => {
    const originalStatus = getOriginalStatus(item)
    if (
      item.id === targetId ||
      originalStatus.id === targetId ||
      (item.type === StatusType.enum.Announce &&
        item.originalStatus.id === targetId)
    ) {
      hasRemoval = true
      return false
    }
    return true
  })
  return hasRemoval ? updated : statuses
}
