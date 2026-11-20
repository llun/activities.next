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
  focusedGroupStatuses?: readonly Status[]
  /**
   * Maps an id that is not a tree row to the ancestor row id its replies
   * belong under — e.g. the later parts of an ancestor self-thread run fold
   * into the run's first row, so a reply to them nests under that row.
   */
  ancestorIdAliases?: Map<string, string>
}

/** From this many loaded replies on, long conversations and side replies fold. */
export const THREAD_FOLD_THRESHOLD = 10
/** How many posts of a conversation show before "Show N more in this conversation". */
export const CONVERSATION_VISIBLE_POSTS = 3

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
 * - Puts the viewer's just-posted replies (`priorityStatusIds`) first among
 *   the top-level replies only: nested, they keep their normal place, so they
 *   never take the first-child slot (and the thread line) from an older reply.
 * - Nests replies beneath their actual parent.
 * - Detects missing/unavailable parents and includes visible replies with parentUnavailable: true.
 * - Prevents cycles in malformed reply chains.
 * Folding is decided at display time by `buildThreadConversations`.
 */
export function buildThreadTree({
  focusedStatus,
  ancestors = [],
  descendants = [],
  hasMoreAncestors = false,
  hasMoreDescendants = false,
  priorityStatusIds,
  focusedGroupStatuses,
  ancestorIdAliases
}: BuildThreadTreeParams): ThreadTree {
  const focusedAuthorId = getStatusAuthorId(focusedStatus)
  const focusedUrl = getStatusUrl(focusedStatus)
  const focusedIds = new Set<string>([focusedStatus.id])
  if (focusedUrl) focusedIds.add(focusedUrl)
  if (focusedStatus.publicId) focusedIds.add(focusedStatus.publicId)
  if (focusedGroupStatuses) {
    for (const groupStatus of focusedGroupStatuses) {
      focusedIds.add(groupStatus.id)
      const groupStatusUrl = getStatusUrl(groupStatus)
      if (groupStatusUrl) focusedIds.add(groupStatusUrl)
      if (groupStatus.publicId) focusedIds.add(groupStatus.publicId)
    }
  }

  const totalDescendants = descendants.length

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
    const rawReplyTarget = getStatusReplyTargetId(item)
    // A folded ancestor id (e.g. a later part of an ancestor run) counts as
    // its alias target row, so replies to it nest under that row.
    const replyTarget = rawReplyTarget
      ? (ancestorIdAliases?.get(rawReplyTarget) ?? rawReplyTarget)
      : null

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
        totalDescendantCount: 0
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

    // Sort children: author-priority tier, then others, each chronological
    const authorChildren: Status[] = []
    const otherChildren: Status[] = []

    for (const child of uniqueChildren) {
      if (getStatusAuthorId(child) === focusedAuthorId) {
        authorChildren.push(child)
      } else {
        otherChildren.push(child)
      }
    }

    authorChildren.sort(compareStatusesChronologically)
    otherChildren.sort(compareStatusesChronologically)

    const sortedChildren = [...authorChildren, ...otherChildren]

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
      totalDescendantCount
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

      const sortedAncestorReplies = uniqueChildren.sort(
        compareStatusesChronologically
      )

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

/**
 * One row of a flattened reply conversation. A `post` row joins the row above
 * it with the thread line (`lineAbove`) only when it replies to that row's
 * post; otherwise, nested, it names its parent with a visible "Replying to".
 * `lineBelow` mirrors the next row's `lineAbove`.
 */
export type ThreadDisplayRow =
  | {
      kind: 'post'
      key: string
      node: ThreadNode
      /** The post this one answers; null for a reply to the opened post. */
      parent: Status | null
      lineAbove: boolean
      lineBelow: boolean
    }
  | {
      kind: 'fold'
      key: string
      /**
       * `conversation`: the rest of a first-reply chain, on the line.
       * `others`: a shown post's replies after its first one.
       */
      fold: 'conversation' | 'others'
      /** The post whose chain or replies fold here. */
      parent: Status
      hiddenCount: number
      expanded: boolean
      lineAbove: boolean
      lineBelow: boolean
    }

/** A top-level reply and everything under it, flattened depth-first. */
export interface ThreadConversation {
  key: string
  rows: ThreadDisplayRow[]
}

export const getConversationFoldKey = (statusId: string) =>
  `conversation:${statusId}`
export const getOthersFoldKey = (statusId: string) => `others:${statusId}`

export const countThreadNodes = (nodes: readonly ThreadNode[]): number =>
  nodes.reduce((sum, node) => sum + 1 + node.totalDescendantCount, 0)

/**
 * Flattens the reply tree into conversations, depth-first, as Mastodon lists
 * replies: a post's first reply follows it on the line, its other replies come
 * after that whole chain and say which post they answer.
 *
 * With `THREAD_FOLD_THRESHOLD` or more loaded replies (or `foldEnabled`,
 * when the caller counts replies these nodes leave out), a chain shows its first
 * `CONVERSATION_VISIBLE_POSTS` posts and then "Show N more in this
 * conversation", and a shown post's other replies fold behind "Show N other
 * replies to <name>". A fold is open when its key (`getConversationFoldKey` /
 * `getOthersFoldKey`, by status id) is in `expandedFolds`, so an opened fold
 * stays open whatever the count does later.
 */
export function buildThreadConversations(
  nodes: readonly ThreadNode[],
  expandedFolds: ReadonlySet<string> = new Set(),
  foldEnabled: boolean = countThreadNodes(nodes) >= THREAD_FOLD_THRESHOLD
): ThreadConversation[] {
  const emitBranch = (
    rows: ThreadDisplayRow[],
    start: ThreadNode,
    parent: Status | null
  ) => {
    const chain: ThreadNode[] = [start]
    while (chain[chain.length - 1].replies.length > 0) {
      chain.push(chain[chain.length - 1].replies[0])
    }

    const canFoldChain =
      foldEnabled && chain.length > CONVERSATION_VISIBLE_POSTS
    const chainKey = getConversationFoldKey(start.status.id)
    const chainExpanded = !canFoldChain || expandedFolds.has(chainKey)
    const shown = chainExpanded
      ? chain
      : chain.slice(0, CONVERSATION_VISIBLE_POSTS)

    shown.forEach((node, index) => {
      if (canFoldChain && index === CONVERSATION_VISIBLE_POSTS) {
        rows.push({
          kind: 'fold',
          key: chainKey,
          fold: 'conversation',
          parent: start.status,
          hiddenCount: chain.length - CONVERSATION_VISIBLE_POSTS,
          expanded: true,
          lineAbove: true,
          lineBelow: false
        })
      }
      rows.push({
        kind: 'post',
        key: node.status.id,
        node,
        parent: index === 0 ? parent : chain[index - 1].status,
        lineAbove: index > 0,
        lineBelow: false
      })
    })
    if (!chainExpanded) {
      rows.push({
        kind: 'fold',
        key: chainKey,
        fold: 'conversation',
        parent: start.status,
        hiddenCount: chain.length - CONVERSATION_VISIBLE_POSTS,
        expanded: false,
        lineAbove: true,
        lineBelow: false
      })
    }

    // Deepest first, which is depth-first order: a later chain post's other
    // replies come before an earlier one's.
    for (let index = shown.length - 1; index >= 0; index--) {
      const node = shown[index]
      const others = node.replies.slice(1)
      if (others.length === 0) continue
      if (!foldEnabled) {
        others.forEach((other) => emitBranch(rows, other, node.status))
        continue
      }
      const othersKey = getOthersFoldKey(node.status.id)
      const othersExpanded = expandedFolds.has(othersKey)
      rows.push({
        kind: 'fold',
        key: othersKey,
        fold: 'others',
        parent: node.status,
        hiddenCount: countThreadNodes(others),
        expanded: othersExpanded,
        lineAbove: false,
        lineBelow: false
      })
      if (othersExpanded) {
        others.forEach((other) => emitBranch(rows, other, node.status))
      }
    }
  }

  return nodes.map((node) => {
    const rows: ThreadDisplayRow[] = []
    emitBranch(rows, node, null)
    // A post continues its line into the row under it when that row joins it,
    // and an open chain fold carries the line on to the post it revealed.
    rows.forEach((row, index) => {
      const next = rows[index + 1]
      if (row.kind === 'fold') {
        row.lineBelow = Boolean(row.expanded && next?.lineAbove)
      } else {
        row.lineBelow = Boolean(next?.lineAbove)
      }
    })
    return { key: node.status.id, rows }
  })
}

/**
 * The fold keys to open so `reply` shows where it lands: for every post on its
 * way up (matched by id or url among `known`), that post's chain and its other
 * replies.
 */
export const getFoldKeysRevealing = (
  reply: Status,
  known: readonly Status[]
): string[] => {
  const keys: string[] = []
  const seen = new Set<string>()
  let currentId = getStatusReplyTargetId(getOriginalStatus(reply))
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const id = currentId
    const parent = known.find(
      (item) =>
        item.id === id ||
        getStatusUrl(item) === id ||
        (Boolean(item.publicId) && item.publicId === id)
    )
    if (!parent) break
    keys.push(getConversationFoldKey(parent.id), getOthersFoldKey(parent.id))
    currentId = getStatusReplyTargetId(getOriginalStatus(parent))
  }
  return keys
}
