import { Attachment, PlaybackType } from '@/lib/types/domain/attachment'
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

/**
 * Non-destructively reconcile attachment metadata (such as resolved playbackType
 * and thumbnailUrl) from incoming statuses into current feed statuses.
 *
 * Preserves:
 * - Appended pages and feed length
 * - Feed order and status identity
 * - Interactive state (likes, bookmarks, reactions)
 * - Object references for untouched statuses and arrays
 */
export const reconcileStatusesMetadata = (
  currentStatuses: Status[],
  incomingStatuses: Status[]
): Status[] => {
  if (
    !incomingStatuses ||
    incomingStatuses.length === 0 ||
    !currentStatuses ||
    currentStatuses.length === 0
  ) {
    return currentStatuses
  }

  const byId = new Map<
    string,
    { playbackType?: PlaybackType | null; thumbnailUrl?: string | null }
  >()
  const byUrl = new Map<
    string,
    { playbackType?: PlaybackType | null; thumbnailUrl?: string | null }
  >()

  for (const status of incomingStatuses) {
    const original = getOriginalStatus(status)
    if (!('attachments' in original) || !Array.isArray(original.attachments)) {
      continue
    }
    for (const att of original.attachments) {
      if (att.playbackType || att.thumbnailUrl) {
        const patch = {
          playbackType: att.playbackType,
          thumbnailUrl: att.thumbnailUrl
        }
        if (att.id) byId.set(att.id, patch)
        if (att.url) byUrl.set(att.url, patch)
      }
    }
  }

  if (byId.size === 0 && byUrl.size === 0) {
    return currentStatuses
  }

  const reconcileAttachmentList = (attachments: Attachment[]) => {
    let hasAttChanges = false
    const reconciledAtts = attachments.map((att) => {
      const patch =
        (att.id ? byId.get(att.id) : undefined) ||
        (att.url ? byUrl.get(att.url) : undefined)

      if (!patch) return att

      let needsPlayback = false
      if (patch.playbackType) {
        if (!att.playbackType) {
          needsPlayback = true
        } else if (
          att.playbackType === 'unknown' &&
          patch.playbackType !== 'unknown'
        ) {
          needsPlayback = true
        }
      }

      let needsThumb = false
      if (patch.thumbnailUrl && !att.thumbnailUrl) {
        needsThumb = true
      }

      if (!needsPlayback && !needsThumb) {
        return att
      }

      hasAttChanges = true
      return {
        ...att,
        ...(needsPlayback ? { playbackType: patch.playbackType } : {}),
        ...(needsThumb ? { thumbnailUrl: patch.thumbnailUrl } : {})
      }
    })

    return hasAttChanges ? reconciledAtts : attachments
  }

  let hasChanges = false
  const updated = currentStatuses.map((item) => {
    if (item.type === StatusType.enum.Announce) {
      const original = item.originalStatus
      if (
        original.type !== StatusType.enum.Announce &&
        'attachments' in original &&
        Array.isArray(original.attachments) &&
        original.attachments.length > 0
      ) {
        const nextAttachments = reconcileAttachmentList(original.attachments)
        if (nextAttachments !== original.attachments) {
          hasChanges = true
          return {
            ...item,
            originalStatus: {
              ...original,
              attachments: nextAttachments
            }
          }
        }
      }
      return item
    }

    if (
      'attachments' in item &&
      Array.isArray(item.attachments) &&
      item.attachments.length > 0
    ) {
      const nextAttachments = reconcileAttachmentList(item.attachments)
      if (nextAttachments !== item.attachments) {
        hasChanges = true
        return {
          ...item,
          attachments: nextAttachments
        }
      }
    }

    return item
  })

  return hasChanges ? updated : currentStatuses
}
