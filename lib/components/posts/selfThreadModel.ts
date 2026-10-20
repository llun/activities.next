import { Status } from '@/lib/types/domain/status'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import {
  CombinedBlock,
  CombinedPart,
  buildCombinedBlocks,
  canTuck
} from './combinedThreadModel'
import {
  getStatusAliases,
  getStatusAuthorId,
  getStatusCreatedAtMs,
  getStatusReplyTargetId,
  sortComponentNodes
} from './timelineModel'

export const LONG_RUN_MAX_PARTS = 6

export interface LongRunCollapseResult {
  isCollapsed: boolean
  visiblePartIndices: number[]
}

export interface BuildSelfThreadParams {
  focusedStatus: Status
  ancestors?: readonly Status[]
  descendants?: readonly Status[]
  /**
   * Whether other people's short replies to the first part may tuck into the
   * run. The fitness page turns this off: its first part is the activity
   * itself, which stays unchanged, so those replies stay under "Replies".
   */
  tuckIntoFirstPart?: boolean
}

export type SelfThreadRunBlock = Extract<CombinedBlock, { kind: 'run' }>

export interface SelfThreadModel {
  run: SelfThreadRunBlock | null
  parts: CombinedPart[]
  openedPartIndex: number
  mergedIds: Set<string>
  mergedStatuses: Status[]
  ancestorsOutsideRun: Status[]
  repliesOutsideRun: Status[]
  replyingToByReplyId: Map<string, string>
  ancestorRuns: SelfThreadRunBlock[]
  descendantRuns: SelfThreadRunBlock[]
}

const getAliases = (status: Status): string[] =>
  getStatusAliases(getActualStatus(status))

const getAuthorId = (status: Status): string =>
  getStatusAuthorId(getActualStatus(status))

const getCreatedAtMs = (status: Status): number =>
  getStatusCreatedAtMs(getActualStatus(status))

const getReplyTargetId = (status: Status): string | null =>
  getStatusReplyTargetId(getActualStatus(status))

/**
 * Orders statuses as the timeline orders a thread row (`sortComponentNodes`):
 * parent before child, oldest first, input order on ties. A status counts as a
 * child only of a status earlier in the input, so a malformed loop cannot drop
 * any of them.
 */
const orderLikeTimeline = (statuses: readonly Status[]): Status[] => {
  const idByAlias = new Map<string, string>()
  for (const status of statuses) {
    for (const alias of getAliases(status)) idByAlias.set(alias, status.id)
  }
  const nodes = new Map(
    statuses.map((status, listIndex) => [
      status.id,
      {
        id: status.id,
        status,
        listIndex,
        createdAt: getCreatedAtMs(status),
        children: [] as string[],
        isRoot: true
      }
    ])
  )
  for (const node of nodes.values()) {
    const target = getReplyTargetId(node.status)
    const parent = target ? nodes.get(idByAlias.get(target) ?? '') : undefined
    if (parent && parent.listIndex < node.listIndex) {
      parent.children.push(node.id)
      node.isRoot = false
    }
  }
  return [...nodes.values()]
    .filter((node) => node.isRoot)
    .flatMap((root) => sortComponentNodes(root.id, nodes))
    .map((id) => nodes.get(id)!.status)
}

interface IndexedStatus {
  status: Status
  index: number
  createdAt: number
}

const sortIndexedStatuses = (a: IndexedStatus, b: IndexedStatus): number => {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt
  }
  return a.index - b.index
}

/**
 * Extracts the author's direct self-reply continuation chain from `descendants`
 * starting at `rootStatus`. At each step, when the author replied to the same
 * post more than once, the earliest reply (breaking ties by original array
 * order) continues the main chain.
 */
export const extractSelfReplyChain = (
  rootStatus: Status,
  descendants: readonly Status[]
): Status[] => {
  const rootAuthorId = getAuthorId(rootStatus)
  if (!rootAuthorId) return []

  const visited = new Set<string>(getAliases(rootStatus))
  const indexed: IndexedStatus[] = descendants.map((status, index) => ({
    status,
    index,
    createdAt: getCreatedAtMs(status)
  }))

  const chain: Status[] = []
  let current = rootStatus

  for (;;) {
    const currentAliases = new Set<string>(getAliases(current))
    const candidates = indexed
      .filter(({ status }) => {
        if (visited.has(status.id)) return false
        if (getAuthorId(status) !== rootAuthorId) return false
        const target = getReplyTargetId(status)
        return Boolean(target && currentAliases.has(target))
      })
      .sort(sortIndexedStatuses)

    if (candidates.length === 0) break

    const next = candidates[0].status
    for (const alias of getAliases(next)) {
      visited.add(alias)
    }
    chain.push(next)
    current = next
  }

  return chain
}

export const formatLongRunCollapseLabel = (count: number): string =>
  `Show ${count} more ${count === 1 ? 'post' : 'posts'} in this thread`

/**
 * Collapses a long self-thread run (> `maxParts` posts) so the first two
 * parts, the opened part, and the last part remain visible while the middle
 * parts fold behind `"Show N more posts in this thread"`.
 */
export const collapseLongRun = (
  parts: readonly CombinedPart[],
  openedPartIndex: number,
  maxParts: number = LONG_RUN_MAX_PARTS
): LongRunCollapseResult => {
  if (parts.length <= maxParts) {
    return {
      isCollapsed: false,
      visiblePartIndices: parts.map((_, index) => index)
    }
  }

  const indexSet = new Set<number>([0, 1, parts.length - 1])
  if (openedPartIndex > 1 && openedPartIndex < parts.length - 1) {
    indexSet.add(openedPartIndex)
  }
  return {
    isCollapsed: true,
    visiblePartIndices: [...indexSet].sort((a, b) => a - b)
  }
}

export const getRunMergedStatuses = (runBlock: SelfThreadRunBlock): Status[] =>
  runBlock.parts.flatMap((part) => [part.status, ...part.insets])

const isRunBlock = (block: CombinedBlock): block is SelfThreadRunBlock =>
  block.kind === 'run'

const findBlockIndexContainingStatus = (
  blocks: readonly CombinedBlock[],
  statusId: string
): number =>
  blocks.findIndex((block) =>
    block.kind === 'post'
      ? block.status.id === statusId
      : block.parts.some(
          (part) =>
            part.status.id === statusId ||
            part.insets.some((inset) => inset.id === statusId)
        )
  )

/**
 * Builds the post-page self-thread model around `focusedStatus`.
 *
 * Unlike the feed row (which splits a run when a reply cannot tuck in), the
 * post page never splits the author's run: replies to earlier parts of the run
 * tuck in when they satisfy `buildCombinedBlocks`'s inset rules, and otherwise
 * stay in `repliesOutsideRun` with a `"Replying to i of n"` label in
 * `replyingToByReplyId`.
 */
export const buildSelfThreadModel = ({
  focusedStatus,
  ancestors = [],
  descendants = [],
  tuckIntoFirstPart = true
}: BuildSelfThreadParams): SelfThreadModel => {
  const focusedAuthorId = getAuthorId(focusedStatus)
  const authorAncestors = ancestors.filter(
    (a) => getAuthorId(a) === focusedAuthorId
  )
  const selfReplyChain = extractSelfReplyChain(focusedStatus, descendants)
  const chain = [...authorAncestors, focusedStatus, ...selfReplyChain]
  const chainIds = new Set(chain.map((s) => s.id))

  const chainIndexByAlias = new Map<string, number>()
  for (let i = 0; i < chain.length; i++) {
    for (const alias of getAliases(chain[i])) {
      chainIndexByAlias.set(alias, i)
    }
  }

  // Any reply in `descendants` that has non-chain child replies in `descendants`
  // stays in the Replies tree so its sub-thread can render beneath it.
  const nonChainTargets = new Set<string>()
  for (const d of descendants) {
    if (chainIds.has(d.id)) continue
    const target = getReplyTargetId(d)
    if (target) {
      nonChainTargets.add(target)
    }
  }
  const hasChildInDescendants = (reply: Status): boolean =>
    getAliases(reply).some((alias) => nonChainTargets.has(alias))

  // A lone post cannot make a run: skip the tuck search, the common case.
  const canRun = chain.length > 1
  // Only structural checks here: whether a reply tucks (gap, cap, the author
  // continuing after it) is left to `buildCombinedBlocks` below.
  const candidates = (canRun ? descendants : []).filter((candidate) => {
    if (chainIds.has(candidate.id)) return false
    const target = getReplyTargetId(candidate)
    const chainIndex = target ? chainIndexByAlias.get(target) : undefined
    if (chainIndex === undefined) return false
    if (chainIndex === 0 && !tuckIntoFirstPart) return false
    if (getAuthorId(candidate) === getAuthorId(chain[chainIndex])) return false
    return !hasChildInDescendants(candidate) && canTuck(candidate)
  })

  const insetIdsOf = (blocks: readonly CombinedBlock[]) =>
    new Set(
      blocks.flatMap((block) =>
        block.kind === 'run'
          ? block.parts.flatMap((part) => part.insets.map((inset) => inset.id))
          : []
      )
    )

  // Add replies one at a time in timeline order, keeping one only while the
  // timeline would still tuck it and every reply kept before it. A reply that
  // would split the run never enters the input, so the run is never split.
  const accepted: Status[] = []
  for (const candidate of orderLikeTimeline([...chain, ...candidates])) {
    if (chainIds.has(candidate.id)) continue
    const tried = [...accepted, candidate]
    const insetIds = insetIdsOf(
      buildCombinedBlocks(orderLikeTimeline([...chain, ...tried]))
    )
    if (tried.every((status) => insetIds.has(status.id))) {
      accepted.push(candidate)
    }
  }

  const blocks = canRun
    ? buildCombinedBlocks(orderLikeTimeline([...chain, ...accepted]))
    : []
  const focusedBlockIndex = findBlockIndexContainingStatus(
    blocks,
    focusedStatus.id
  )
  const focusedBlock =
    focusedBlockIndex >= 0 ? blocks[focusedBlockIndex] : undefined
  const ancestorRuns =
    focusedBlockIndex > 0
      ? blocks.slice(0, focusedBlockIndex).filter(isRunBlock)
      : []
  const descendantRuns =
    focusedBlockIndex >= 0
      ? blocks.slice(focusedBlockIndex + 1).filter(isRunBlock)
      : []

  const allRunBlocks: SelfThreadRunBlock[] = [
    ...ancestorRuns,
    ...(focusedBlock && isRunBlock(focusedBlock) ? [focusedBlock] : []),
    ...descendantRuns
  ]
  const earlierPartByAlias = new Map<
    string,
    { partIndex: number; numParts: number }
  >()
  for (const runBlock of allRunBlocks) {
    const count = runBlock.parts.length
    // A separate ancestor run sits above the opened post, so a reply to any of
    // its parts, the last one included, would otherwise read as a reply to it.
    const labelledCount = ancestorRuns.includes(runBlock) ? count : count - 1
    for (let i = 0; i < labelledCount; i++) {
      for (const alias of getAliases(runBlock.parts[i].status)) {
        earlierPartByAlias.set(alias, { partIndex: i, numParts: count })
      }
    }
  }

  const getReplyingToLabels = (replies: readonly Status[]) => {
    const labels = new Map<string, string>()
    for (const reply of replies) {
      const target = getReplyTargetId(reply)
      if (!target) continue
      const match = earlierPartByAlias.get(target)
      if (match) {
        labels.set(
          reply.id,
          `Replying to ${match.partIndex + 1} of ${match.numParts}`
        )
      }
    }
    return labels
  }

  if (!focusedBlock || focusedBlock.kind !== 'run') {
    return {
      run: null,
      parts: [],
      openedPartIndex: -1,
      mergedIds: new Set<string>(),
      mergedStatuses: [],
      ancestorsOutsideRun: [...ancestors],
      repliesOutsideRun: [...descendants],
      replyingToByReplyId: getReplyingToLabels(descendants),
      ancestorRuns,
      descendantRuns
    }
  }

  const parts = focusedBlock.parts

  const openedPartIndex = parts.findIndex(
    (part) =>
      part.status.id === focusedStatus.id ||
      part.insets.some((inset) => inset.id === focusedStatus.id)
  )

  const mergedStatuses: Status[] = []
  const mergedIds = new Set<string>()
  for (const part of parts) {
    mergedStatuses.push(part.status)
    mergedIds.add(part.status.id)
    for (const inset of part.insets) {
      mergedStatuses.push(inset)
      mergedIds.add(inset.id)
    }
  }

  const ancestorsOutsideRun = ancestors.filter((a) => !mergedIds.has(a.id))
  const repliesOutsideRun = descendants.filter((d) => !mergedIds.has(d.id))

  return {
    run: focusedBlock,
    parts,
    openedPartIndex,
    mergedIds,
    mergedStatuses,
    ancestorsOutsideRun,
    repliesOutsideRun,
    replyingToByReplyId: getReplyingToLabels(repliesOutsideRun),
    ancestorRuns,
    descendantRuns
  }
}
