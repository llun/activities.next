import { Status, StatusType } from '@/lib/types/domain/status'
import { Status as MastodonStatus } from '@/lib/types/mastodon/status'

export type TimelineRow =
  | { kind: 'status'; key: string; entryId: string }
  | { kind: 'thread' | 'conversation'; key: string; entryIds: string[] }
  | { kind: 'boosts'; key: string; entryIds: string[] }

export type TimelineInputStatus = Status | MastodonStatus

export interface TimelineGroupingOptions {
  viewerId?: string | null
  seenWrapperIds?: Iterable<string>
  seenBoostTargetIds?: Iterable<string>
  maxSeenBoostTargets?: number
  /**
   * Whether to group eligible consecutive boosts into a carousel row.
   * Defaults to false (boosts stay as individual timeline rows).
   */
  groupBoosts?: boolean
}

export interface GroupTimelineResult {
  rows: TimelineRow[]
  seenBoostTargetIds: Set<string>
  seenWrapperIds: Set<string>
}

export const BOOSTS_LIMIT = 100
export const BOOSTS_CAROUSEL_MIN_ENTRIES = 10
export const BOOSTS_SERIAL_TRIGGER_COUNT = 3

/**
 * Returns all entry IDs contained in a TimelineRow regardless of its kind.
 */
export const getRowEntryIds = (row: TimelineRow): string[] => {
  if (row.kind === 'status') {
    return [row.entryId]
  }
  return [...row.entryIds]
}

export const isBoostStatus = (status: TimelineInputStatus): boolean => {
  if ('type' in status && status.type === StatusType.enum.Announce) {
    return true
  }
  if ('reblog' in status && status.reblog != null) {
    return true
  }
  return false
}

export const getOriginalStatusId = (status: TimelineInputStatus): string => {
  if ('type' in status && status.type === StatusType.enum.Announce) {
    return status.originalStatus.id
  }
  if ('reblog' in status && status.reblog != null) {
    return status.reblog.id
  }
  return status.id
}

export const getStatusAuthorId = (status: TimelineInputStatus): string => {
  if ('type' in status) {
    if (status.type === StatusType.enum.Announce) {
      return status.originalStatus.actorId ?? status.actorId
    }
    return status.actorId
  }
  if ('reblog' in status && status.reblog != null) {
    return (
      status.reblog.account?.id ??
      status.reblog.account?.username ??
      status.account?.id ??
      ''
    )
  }
  return status.account?.id ?? status.account?.username ?? ''
}

export const getStatusCreatedAtMs = (status: TimelineInputStatus): number => {
  if ('createdAt' in status) {
    return typeof status.createdAt === 'number'
      ? status.createdAt
      : new Date(status.createdAt).getTime()
  }
  return new Date(status.created_at).getTime()
}

export const getStatusReplyTargetId = (
  status: TimelineInputStatus
): string | null => {
  if (isBoostStatus(status)) {
    return null
  }
  if ('reply' in status && typeof status.reply === 'string') {
    return status.reply.trim() || null
  }
  if ('in_reply_to_id' in status && typeof status.in_reply_to_id === 'string') {
    return status.in_reply_to_id.trim() || null
  }
  return null
}

const isGroupActorBoost = (status: TimelineInputStatus): boolean => {
  if ('type' in status && status.type === StatusType.enum.Announce) {
    return status.actor?.type === 'Group'
  }
  if ('reblog' in status && status.reblog != null) {
    return Boolean(status.account?.group)
  }
  return false
}

/**
 * Collects all known identifier aliases for a status (id, url, uri, publicId).
 */
const getStatusAliases = (status: TimelineInputStatus): string[] => {
  const aliases: string[] = [status.id]
  if ('url' in status && typeof status.url === 'string' && status.url) {
    aliases.push(status.url)
  }
  if ('uri' in status && typeof status.uri === 'string' && status.uri) {
    aliases.push(status.uri)
  }
  if (
    'publicId' in status &&
    typeof status.publicId === 'string' &&
    status.publicId
  ) {
    aliases.push(status.publicId)
  }
  return aliases
}

/**
 * Pure boost carousel grouper matching Phanpy rules.
 */
export const groupBoostEntries = (
  items: readonly TimelineInputStatus[]
): {
  grouped: boolean
  items: (
    | { kind: 'item'; item: TimelineInputStatus }
    | { kind: 'boosts'; items: TimelineInputStatus[] }
  )[]
} => {
  const boostStash: TimelineInputStatus[] = []
  const nonBoostItems: TimelineInputStatus[] = []
  let serialBoosts = 0
  let maxSerialBoosts = 0

  for (const item of items) {
    if (isBoostStatus(item) && !isGroupActorBoost(item)) {
      boostStash.push(item)
      serialBoosts++
      if (serialBoosts > maxSerialBoosts) {
        maxSerialBoosts = serialBoosts
      }
    } else {
      nonBoostItems.push(item)
      if (serialBoosts < BOOSTS_SERIAL_TRIGGER_COUNT) {
        serialBoosts = 0
      }
    }
  }

  const shouldGroup =
    items.length > BOOSTS_CAROUSEL_MIN_ENTRIES &&
    (boostStash.length > items.length / 4 ||
      maxSerialBoosts >= BOOSTS_SERIAL_TRIGGER_COUNT)

  if (!shouldGroup) {
    return {
      grouped: false,
      items: items.map((item) => ({ kind: 'item', item }))
    }
  }

  const mappedNonBoosts = nonBoostItems.map(
    (item) => ({ kind: 'item', item }) as const
  )
  const boostGroup = { kind: 'boosts', items: boostStash } as const

  if (boostStash.length > (items.length * 3) / 4) {
    return {
      grouped: true,
      items: [...mappedNonBoosts, boostGroup]
    }
  }

  const half = Math.floor(mappedNonBoosts.length / 2)
  return {
    grouped: true,
    items: [
      ...mappedNonBoosts.slice(0, half),
      boostGroup,
      ...mappedNonBoosts.slice(half)
    ]
  }
}

/**
 * Deduplicates overlapping page entries by wrapper ID and suppresses
 * repeated boost cards by underlying original identity in presentation.
 */
export const deduplicateAndSuppress = (
  statuses: readonly TimelineInputStatus[],
  options?: TimelineGroupingOptions
): {
  filtered: TimelineInputStatus[]
  seenWrapperIds: Set<string>
  seenBoostTargetIds: Set<string>
} => {
  const maxSeenBoostTargets = options?.maxSeenBoostTargets ?? BOOSTS_LIMIT
  const seenWrapperIds = new Set<string>(options?.seenWrapperIds ?? [])
  const seenBoostTargetsOrder: string[] = []
  const seenBoostTargetIds = new Set<string>()

  if (options?.seenBoostTargetIds) {
    for (const targetId of options.seenBoostTargetIds) {
      if (!seenBoostTargetIds.has(targetId)) {
        seenBoostTargetIds.add(targetId)
        seenBoostTargetsOrder.push(targetId)
      }
    }
  }

  const filtered: TimelineInputStatus[] = []

  for (const status of statuses) {
    if (seenWrapperIds.has(status.id)) {
      continue
    }
    seenWrapperIds.add(status.id)

    if (isBoostStatus(status)) {
      const targetId = getOriginalStatusId(status)
      if (seenBoostTargetIds.has(targetId)) {
        // Suppress repeated boost card in presentation
        continue
      }
      seenBoostTargetIds.add(targetId)
      seenBoostTargetsOrder.push(targetId)

      if (seenBoostTargetsOrder.length > maxSeenBoostTargets) {
        const evicted = seenBoostTargetsOrder.shift()
        if (evicted) {
          seenBoostTargetIds.delete(evicted)
        }
      }
    }

    filtered.push(status)
  }

  return {
    filtered,
    seenWrapperIds,
    seenBoostTargetIds
  }
}

interface ComponentNode {
  id: string
  item: TimelineInputStatus
  listIndex: number
  parentId: string | null
  children: string[]
  authorId: string
  createdAt: number
}

/**
 * Given a set of nodes and valid parent relationships, sorts each connected
 * component tree topologically:
 * - Strict parent-before-child
 * - Oldest first among independent siblings
 * - Server order (listIndex) on timestamp ties
 * - If malformed timestamps disagree with reply graph, parent-before-child wins
 */
const sortComponentNodes = (
  rootId: string,
  nodeMap: Map<string, ComponentNode>
): string[] => {
  const result: string[] = []
  const root = nodeMap.get(rootId)
  if (!root) return [rootId]

  // Priority queue of nodes whose parent has already been emitted.
  // Initially only the root is ready.
  const ready: ComponentNode[] = [root]

  while (ready.length > 0) {
    // Sort ready nodes: oldest first, breaking ties by server order (listIndex ascending)
    ready.sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt
      }
      return a.listIndex - b.listIndex
    })

    const next = ready.shift()!
    result.push(next.id)

    // Unlock children
    for (const childId of next.children) {
      const childNode = nodeMap.get(childId)
      if (childNode) {
        ready.push(childNode)
      }
    }
  }

  return result
}

/**
 * Pure, immutable per-page timeline grouper.
 * Separates timeline pages into display rows: status, thread, conversation, boosts.
 */
export const groupTimelinePage = (
  statuses: readonly TimelineInputStatus[],
  options?: TimelineGroupingOptions
): TimelineRow[] => {
  return groupTimelinePageWithTracking(statuses, options).rows
}

/**
 * Pure per-page timeline grouper with updated seen tracker output.
 */
export const groupTimelinePageWithTracking = (
  statuses: readonly TimelineInputStatus[],
  options?: TimelineGroupingOptions
): GroupTimelineResult => {
  const { filtered, seenWrapperIds, seenBoostTargetIds } =
    deduplicateAndSuppress(statuses, options)

  const groupBoosts = options?.groupBoosts ?? false

  // Step 2: Intermediate list with optional boost carousel grouping (Stage 7)
  const intermediateList: (
    | { kind: 'status'; item: TimelineInputStatus }
    | { kind: 'boosts'; items: TimelineInputStatus[] }
  )[] = groupBoosts
    ? groupBoostEntries(filtered).items.map((entry) => {
        if (entry.kind === 'boosts') {
          return { kind: 'boosts', items: entry.items }
        }
        return { kind: 'status', item: entry.item }
      })
    : filtered.map((item) => ({ kind: 'status', item }))

  // Index eligible unboosted entries and known aliases
  const aliasToCanonicalId = new Map<string, string>()
  const unboostedById = new Map<
    string,
    { item: TimelineInputStatus; listIndex: number }
  >()
  const preservedRows: { row: TimelineRow; listIndex: number }[] = []

  for (let idx = 0; idx < intermediateList.length; idx++) {
    const entry = intermediateList[idx]
    if (entry.kind === 'boosts') {
      const entryIds = entry.items.map((b) => b.id)
      preservedRows.push({
        row: {
          kind: 'boosts',
          key: `boosts:${entryIds.join(':')}`,
          entryIds
        },
        listIndex: idx
      })
      continue
    }

    const item = entry.item
    if (isBoostStatus(item)) {
      preservedRows.push({
        row: {
          kind: 'status',
          key: `status:${item.id}`,
          entryId: item.id
        },
        listIndex: idx
      })
      continue
    }

    unboostedById.set(item.id, { item, listIndex: idx })
    for (const alias of getStatusAliases(item)) {
      aliasToCanonicalId.set(alias, item.id)
    }
  }

  // Build directed reply edges among unboosted entries
  // edge: childId -> parentId
  const parentOf = new Map<string, string>()
  for (const [id, { item }] of unboostedById.entries()) {
    const replyTarget = getStatusReplyTargetId(item)
    if (replyTarget) {
      const canonicalParentId = aliasToCanonicalId.get(replyTarget)
      if (canonicalParentId && canonicalParentId !== id) {
        parentOf.set(id, canonicalParentId)
      }
    }
  }

  // Detect and reject cycles
  // Any node in a cycle has its reply edges removed and remains a standalone row
  const inCycle = new Set<string>()
  for (const startId of unboostedById.keys()) {
    const visitedInPath: string[] = []
    let curr: string | undefined = startId
    while (curr && parentOf.has(curr)) {
      const next: string = parentOf.get(curr)!
      const cycleStartIdx = visitedInPath.indexOf(next)
      if (cycleStartIdx !== -1) {
        // Cycle detected
        for (let i = cycleStartIdx; i < visitedInPath.length; i++) {
          inCycle.add(visitedInPath[i])
        }
        inCycle.add(curr)
        break
      }
      if (next === startId) {
        inCycle.add(startId)
        for (const p of visitedInPath) {
          inCycle.add(p)
        }
        break
      }
      visitedInPath.push(curr)
      curr = next
    }
  }

  // Remove edges touching cycle nodes
  for (const cycleNode of inCycle) {
    parentOf.delete(cycleNode)
  }
  for (const [child, parent] of [...parentOf.entries()]) {
    if (inCycle.has(parent)) {
      parentOf.delete(child)
    }
  }

  // Build adjacency / tree structure for valid components
  const childrenOf = new Map<string, string[]>()
  for (const id of unboostedById.keys()) {
    childrenOf.set(id, [])
  }
  for (const [child, parent] of parentOf.entries()) {
    childrenOf.get(parent)?.push(child)
  }

  // Find connected components
  // Each tree component has exactly one root (node with no parent in page)
  const nodeMap = new Map<string, ComponentNode>()
  for (const [id, { item, listIndex }] of unboostedById.entries()) {
    nodeMap.set(id, {
      id,
      item,
      listIndex,
      parentId: parentOf.get(id) ?? null,
      children: childrenOf.get(id) ?? [],
      authorId: getStatusAuthorId(item),
      createdAt: getStatusCreatedAtMs(item)
    })
  }

  // Find roots of all components
  const roots: string[] = []
  for (const [id, node] of nodeMap.entries()) {
    if (!node.parentId) {
      roots.push(id)
    }
  }

  // Process each component from its root
  for (const rootId of roots) {
    const rootNode = nodeMap.get(rootId)!
    const sortedIds = sortComponentNodes(rootId, nodeMap)

    if (sortedIds.length === 1) {
      // Standalone status
      preservedRows.push({
        row: {
          kind: 'status',
          key: `status:${rootId}`,
          entryId: rootId
        },
        listIndex: rootNode.listIndex
      })
      continue
    }

    // Connected group: determine min list index in the feed
    const minListIndex = Math.min(
      ...sortedIds.map((id) => nodeMap.get(id)!.listIndex)
    )

    // Distinct authors check
    const authorIds = new Set<string>()
    for (const id of sortedIds) {
      authorIds.add(nodeMap.get(id)!.authorId)
    }
    const isSingleAuthor = authorIds.size === 1
    const kind: 'thread' | 'conversation' = isSingleAuthor
      ? 'thread'
      : 'conversation'

    preservedRows.push({
      row: {
        kind,
        key: `${kind}:${sortedIds.join(':')}`,
        entryIds: sortedIds
      },
      listIndex: minListIndex
    })
  }

  // Sort rows by first list index ascending
  preservedRows.sort((a, b) => a.listIndex - b.listIndex)

  return {
    rows: preservedRows.map((r) => r.row),
    seenWrapperIds,
    seenBoostTargetIds
  }
}
