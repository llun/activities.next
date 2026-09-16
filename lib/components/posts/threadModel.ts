import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'

export interface ThreadNode {
  status: Status
  depth: number
  parentUnavailable?: boolean
  replies: ThreadNode[]
  totalDescendantCount: number
  initiallyCollapsed: boolean
}

export interface ThreadTree {
  focusedStatus: Status
  ancestors: Status[]
  ancestorReplies?: Record<string, ThreadNode[]>
  descendants: ThreadNode[]
  totalDescendants: number
  hasMoreAncestors: boolean
  hasMoreDescendants: boolean
}

export interface BuildThreadTreeParams {
  focusedStatus: Status
  ancestors?: Status[]
  descendants?: Status[]
  hasMoreAncestors?: boolean
  hasMoreDescendants?: boolean
  priorityStatusIds?: Set<string>
}

export const THREAD_COLLAPSE_THRESHOLD = 10

export const getStatusAuthorId = (status: Status): string => {
  if (status.type === StatusType.enum.Announce) {
    return status.originalStatus.actorId ?? status.actorId
  }
  return status.actorId ?? status.actor?.id ?? ''
}

export const getStatusCreatedAtMs = (status: Status): number => {
  if (typeof status.createdAt === 'number') return status.createdAt
  return new Date(status.createdAt).getTime()
}

export const getStatusReplyTargetId = (status: Status): string | null => {
  if (status.type === StatusType.enum.Announce) return null
  if (typeof status.reply === 'string') return status.reply.trim() || null
  return null
}

export const getStatusUrl = (status: Status): string => {
  return getOriginalStatus(status).url
}

const compareStatusesChronologically = (a: Status, b: Status): number => {
  const timeA = getStatusCreatedAtMs(a)
  const timeB = getStatusCreatedAtMs(b)
  if (timeA !== timeB) return timeA - timeB
  return a.id.localeCompare(b.id)
}

/**
 * Pure, immutable thread hierarchy builder that mirrors Phanpy's thread model:
 * - Promotes focused-author replies to the top tier while preserving chronological order within tiers.
 * - Nests replies beneath their actual parent.
 * - Detects missing/unavailable parents and includes visible replies with parentUnavailable: true.
 * - Prevents cycles in malformed reply chains.
 * - Applies collapse policy: expanded if total < 10; collapses branches if total >= 10.
 */
export function buildThreadTree({
  focusedStatus,
  ancestors = [],
  descendants = [],
  hasMoreAncestors = false,
  hasMoreDescendants = false,
  priorityStatusIds
}: BuildThreadTreeParams): ThreadTree {
  const focusedAuthorId = getStatusAuthorId(focusedStatus)
  const focusedUrl = getStatusUrl(focusedStatus)
  const focusedIds = new Set<string>([focusedStatus.id])
  if (focusedUrl) focusedIds.add(focusedUrl)
  if (focusedStatus.publicId) focusedIds.add(focusedStatus.publicId)

  const totalDescendants = descendants.length
  const shouldCollapseBranches = totalDescendants >= THREAD_COLLAPSE_THRESHOLD

  // Index descendants by all known IDs/URLs
  const descendantMap = new Map<string, Status>()
  for (const item of descendants) {
    descendantMap.set(item.id, item)
    const itemUrl = getStatusUrl(item)
    if (itemUrl) descendantMap.set(itemUrl, item)
    if (item.publicId) descendantMap.set(item.publicId, item)
  }

  // Index ancestors by all known IDs/URLs
  const ancestorMap = new Map<string, Status>()
  const ancestorIds = new Set<string>()
  for (const item of ancestors) {
    ancestorMap.set(item.id, item)
    ancestorIds.add(item.id)
    const itemUrl = getStatusUrl(item)
    if (itemUrl) {
      ancestorMap.set(itemUrl, item)
      ancestorIds.add(itemUrl)
    }
    if (item.publicId) {
      ancestorMap.set(item.publicId, item)
      ancestorIds.add(item.publicId)
    }
  }

  // Build adjacency list of parentId -> children Status[]
  const childrenByParent = new Map<string, Status[]>()
  const topLevelStatuses: Array<{
    status: Status
    parentUnavailable?: boolean
  }> = []

  // Check for cycles by tracking ancestors along the chain
  const findCycle = (startId: string): boolean => {
    const visited = new Set<string>()
    let currentId: string | null = startId
    while (currentId) {
      if (visited.has(currentId)) return true
      visited.add(currentId)
      const currentStatus = descendantMap.get(currentId)
      if (!currentStatus) break
      currentId = getStatusReplyTargetId(currentStatus)
    }
    return false
  }

  for (const item of descendants) {
    const replyTarget = getStatusReplyTargetId(item)

    if (!replyTarget || focusedIds.has(replyTarget)) {
      // Direct reply to the focused post
      topLevelStatuses.push({ status: item })
    } else if (ancestorIds.has(replyTarget)) {
      // Direct reply to an ancestor post
      const parent = ancestorMap.get(replyTarget)
      const parentId = parent ? parent.id : replyTarget
      const existing = childrenByParent.get(parentId) ?? []
      existing.push(item)
      childrenByParent.set(parentId, existing)
    } else if (descendantMap.has(replyTarget)) {
      if (findCycle(item.id)) {
        // Cycle detected: emit as top-level with parentUnavailable flag to prevent infinite loops
        topLevelStatuses.push({ status: item, parentUnavailable: true })
      } else {
        const parent = descendantMap.get(replyTarget)
        const parentId = parent ? parent.id : replyTarget
        const existing = childrenByParent.get(parentId) ?? []
        existing.push(item)
        childrenByParent.set(parentId, existing)
      }
    } else {
      // Reply target is not in the focused post or loaded descendants:
      // unavailable/missing parent boundary
      topLevelStatuses.push({ status: item, parentUnavailable: true })
    }
  }

  // Recursively build ThreadNode tree
  const buildNode = (
    status: Status,
    depth: number,
    visitedIds: Set<string>,
    parentUnavailable?: boolean
  ): ThreadNode => {
    if (
      visitedIds.has(status.id) ||
      (Boolean(status.publicId) && visitedIds.has(status.publicId!))
    ) {
      return {
        status,
        depth,
        parentUnavailable: true,
        replies: [],
        totalDescendantCount: 0,
        initiallyCollapsed: false
      }
    }
    const nextVisited = new Set(visitedIds).add(status.id)
    const statusUrl = getStatusUrl(status)
    if (statusUrl) nextVisited.add(statusUrl)
    if (status.publicId) nextVisited.add(status.publicId)

    const rawChildren: Status[] = [
      ...(childrenByParent.get(status.id) ?? []),
      ...(statusUrl && statusUrl !== status.id
        ? (childrenByParent.get(statusUrl) ?? [])
        : []),
      ...(status.publicId && status.publicId !== status.id
        ? (childrenByParent.get(status.publicId) ?? [])
        : [])
    ]

    // Deduplicate children by ID
    const uniqueChildrenMap = new Map<string, Status>()
    for (const child of rawChildren) {
      uniqueChildrenMap.set(child.id, child)
    }
    const uniqueChildren = [...uniqueChildrenMap.values()]

    // Sort children: priority replies first, then author-priority tier, then others, sorted chronologically
    const priorityChildren: Status[] = []
    const authorChildren: Status[] = []
    const otherChildren: Status[] = []

    for (const child of uniqueChildren) {
      if (priorityStatusIds?.has(child.id)) {
        priorityChildren.push(child)
      } else if (getStatusAuthorId(child) === focusedAuthorId) {
        authorChildren.push(child)
      } else {
        otherChildren.push(child)
      }
    }

    priorityChildren.sort(
      (a, b) => getStatusCreatedAtMs(b) - getStatusCreatedAtMs(a)
    )
    authorChildren.sort(compareStatusesChronologically)
    otherChildren.sort(compareStatusesChronologically)

    const sortedChildren = [
      ...priorityChildren,
      ...authorChildren,
      ...otherChildren
    ]

    const childNodes = sortedChildren.map((child) =>
      buildNode(child, depth + 1, nextVisited)
    )

    const totalDescendantCount = childNodes.reduce(
      (sum, child) => sum + 1 + child.totalDescendantCount,
      0
    )

    return {
      status,
      depth,
      ...(parentUnavailable ? { parentUnavailable: true } : {}),
      replies: childNodes,
      totalDescendantCount,
      initiallyCollapsed:
        shouldCollapseBranches && depth >= 0 && childNodes.length > 0
    }
  }

  // Sort top-level statuses: priority replies first, then focused-author, then others, sorted chronologically
  const priorityTopLevel: Array<{
    status: Status
    parentUnavailable?: boolean
  }> = []
  const authorTopLevel: Array<{ status: Status; parentUnavailable?: boolean }> =
    []
  const otherTopLevel: Array<{ status: Status; parentUnavailable?: boolean }> =
    []

  for (const item of topLevelStatuses) {
    if (priorityStatusIds?.has(item.status.id)) {
      priorityTopLevel.push(item)
    } else if (getStatusAuthorId(item.status) === focusedAuthorId) {
      authorTopLevel.push(item)
    } else {
      otherTopLevel.push(item)
    }
  }

  priorityTopLevel.sort(
    (a, b) => getStatusCreatedAtMs(b.status) - getStatusCreatedAtMs(a.status)
  )
  authorTopLevel.sort((a, b) =>
    compareStatusesChronologically(a.status, b.status)
  )
  otherTopLevel.sort((a, b) =>
    compareStatusesChronologically(a.status, b.status)
  )

  const sortedTopLevel = [
    ...priorityTopLevel,
    ...authorTopLevel,
    ...otherTopLevel
  ]

  const descendantNodes = sortedTopLevel.map((item) =>
    buildNode(item.status, 0, new Set(), item.parentUnavailable)
  )

  const ancestorReplies: Record<string, ThreadNode[]> = {}
  for (const ancestor of ancestors) {
    const rawChildren: Status[] = [
      ...(childrenByParent.get(ancestor.id) ?? []),
      ...(getStatusUrl(ancestor) && getStatusUrl(ancestor) !== ancestor.id
        ? (childrenByParent.get(getStatusUrl(ancestor)) ?? [])
        : []),
      ...(ancestor.publicId && ancestor.publicId !== ancestor.id
        ? (childrenByParent.get(ancestor.publicId) ?? [])
        : [])
    ]

    if (rawChildren.length > 0) {
      const uniqueChildrenMap = new Map<string, Status>()
      for (const child of rawChildren) {
        uniqueChildrenMap.set(child.id, child)
      }
      const uniqueChildren = [...uniqueChildrenMap.values()]

      const priorityAncestorReplies: Status[] = []
      const regularAncestorReplies: Status[] = []
      for (const child of uniqueChildren) {
        if (priorityStatusIds?.has(child.id)) {
          priorityAncestorReplies.push(child)
        } else {
          regularAncestorReplies.push(child)
        }
      }
      priorityAncestorReplies.sort(
        (a, b) => getStatusCreatedAtMs(b) - getStatusCreatedAtMs(a)
      )
      regularAncestorReplies.sort(compareStatusesChronologically)
      const sortedAncestorReplies = [
        ...priorityAncestorReplies,
        ...regularAncestorReplies
      ]

      ancestorReplies[ancestor.id] = sortedAncestorReplies.map((child) =>
        buildNode(child, 1, new Set([ancestor.id]))
      )
    }
  }

  return {
    focusedStatus,
    ancestors,
    ancestorReplies,
    descendants: descendantNodes,
    totalDescendants,
    hasMoreAncestors,
    hasMoreDescendants
  }
}
