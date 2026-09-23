import { StatusEditRevision } from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'
import { StatusEditChange } from '@/lib/types/domain/status'

type Snapshot = Pick<
  StatusEditRevision,
  'text' | 'summary' | 'sensitive' | 'attachments' | 'pollOptions' | 'available'
>

export interface StatusEditTransition {
  editedAt: number
  changes: StatusEditChange[]
  changeDetailsUnavailable: boolean
}

const textChange = (
  beforeText: string,
  afterText: string
): StatusEditChange | undefined => {
  const beforeHasText = beforeText.trim().length > 0
  const afterHasText = afterText.trim().length > 0

  if (!beforeHasText && afterHasText) return 'text-added'
  if (beforeHasText && !afterHasText) return 'text-removed'
  if (beforeHasText && afterHasText && beforeText !== afterText) {
    return 'text-updated'
  }
}

const contentWarning = (summary: string | null) => summary?.trim() || null

type AttachmentKind = 'images' | 'attachments'

const getAttachmentKind = (attachment: Attachment): AttachmentKind =>
  attachment.mediaType.toLowerCase().startsWith('image/')
    ? 'images'
    : 'attachments'

const visibleAttachmentProperties = (attachment: Attachment) =>
  JSON.stringify([
    attachment.url,
    attachment.mediaType,
    attachment.name,
    attachment.focus ? [attachment.focus.x, attachment.focus.y] : null
  ])

const sameMultiset = (before: string[], after: string[]) => {
  if (before.length !== after.length) return false

  const counts = new Map<string, number>()
  for (const key of before) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const key of after) {
    const count = counts.get(key)
    if (!count) return false
    if (count === 1) counts.delete(key)
    else counts.set(key, count - 1)
  }

  return counts.size === 0
}

const getCollectionChange = (
  before: Attachment[],
  after: Attachment[],
  kind: AttachmentKind
): StatusEditChange | undefined => {
  const beforeItems = before.filter((item) => getAttachmentKind(item) === kind)
  const afterItems = after.filter((item) => getAttachmentKind(item) === kind)
  const beforeKeys = beforeItems.map(visibleAttachmentProperties)
  const afterKeys = afterItems.map(visibleAttachmentProperties)

  if (JSON.stringify(beforeKeys) === JSON.stringify(afterKeys)) return
  if (beforeItems.length === 0) return `${kind}-added`
  if (afterItems.length === 0) return `${kind}-removed`

  const beforeCounts = new Map<string, number>()
  const afterCounts = new Map<string, number>()
  for (const key of beforeKeys) {
    beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1)
  }
  for (const key of afterKeys) {
    afterCounts.set(key, (afterCounts.get(key) ?? 0) + 1)
  }

  const hasRemovedItems = [...beforeCounts].some(
    ([key, count]) => count > (afterCounts.get(key) ?? 0)
  )
  const hasAddedItems = [...afterCounts].some(
    ([key, count]) => count > (beforeCounts.get(key) ?? 0)
  )

  if (hasAddedItems && !hasRemovedItems) return `${kind}-added`
  if (hasRemovedItems && !hasAddedItems) return `${kind}-removed`
  return `${kind}-updated`
}

export const getStatusEditTransitions = (
  revisions: StatusEditRevision[],
  current: Snapshot,
  isPoll: boolean
): StatusEditTransition[] =>
  revisions.map((revision, index) => {
    const nextRevision = revisions[index + 1]
    const next: Snapshot = nextRevision ?? current
    const changes: StatusEditChange[] = []
    let changeDetailsUnavailable = false

    if (revision.available.text && next.available.text) {
      const change = textChange(revision.text, next.text)
      if (change) changes.push(change)
    } else {
      changeDetailsUnavailable = true
    }

    if (revision.available.summary && next.available.summary) {
      if (contentWarning(revision.summary) !== contentWarning(next.summary)) {
        changes.push('content-warning-changed')
      }
    } else {
      changeDetailsUnavailable = true
    }

    if (revision.available.sensitive && next.available.sensitive) {
      if (revision.sensitive !== next.sensitive) {
        changes.push('sensitive-setting-changed')
      }
    } else {
      changeDetailsUnavailable = true
    }

    if (revision.available.attachments && next.available.attachments) {
      const beforeAttachments = revision.attachments ?? []
      const afterAttachments = next.attachments ?? []
      const imageChange = getCollectionChange(
        beforeAttachments,
        afterAttachments,
        'images'
      )
      const attachmentChange = getCollectionChange(
        beforeAttachments,
        afterAttachments,
        'attachments'
      )
      if (imageChange) changes.push(imageChange)
      if (attachmentChange) changes.push(attachmentChange)

      // Preserve order across media kinds as well as within each group. If the
      // visible attachment list is the same set in a different order, mark the
      // kinds whose items moved; additions and removals are already described
      // by the per-kind comparisons above.
      const beforeKeys = beforeAttachments.map(visibleAttachmentProperties)
      const afterKeys = afterAttachments.map(visibleAttachmentProperties)
      if (
        !imageChange &&
        !attachmentChange &&
        JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys) &&
        sameMultiset(beforeKeys, afterKeys)
      ) {
        const changedKinds = new Set<AttachmentKind>()
        for (let index = 0; index < beforeKeys.length; index++) {
          if (beforeKeys[index] !== afterKeys[index]) {
            changedKinds.add(getAttachmentKind(beforeAttachments[index]))
            changedKinds.add(getAttachmentKind(afterAttachments[index]))
          }
        }
        if (changedKinds.has('images')) changes.push('images-updated')
        if (changedKinds.has('attachments')) {
          changes.push('attachments-updated')
        }
      }
    } else {
      changeDetailsUnavailable = true
    }

    if (isPoll) {
      if (
        revision.available.pollOptions &&
        next.available.pollOptions &&
        revision.pollOptions !== null &&
        next.pollOptions !== null
      ) {
        if (
          JSON.stringify(revision.pollOptions) !==
          JSON.stringify(next.pollOptions)
        ) {
          changes.push('poll-options-changed')
        }
      } else {
        changeDetailsUnavailable = true
      }
    }

    return {
      editedAt: revision.supersededAt,
      changes,
      changeDetailsUnavailable
    }
  })
