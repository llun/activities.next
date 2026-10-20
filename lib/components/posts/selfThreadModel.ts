import { Status } from '@/lib/types/domain/status'
import { getVisibility } from '@/lib/utils/getVisibility'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import {
  COMBINE_MAX_INSETS,
  CombinedBlock,
  CombinedPart,
  buildCombinedBlocks,
  canTuck,
  isWithinGap
} from './combinedThreadModel'
import {
  getStatusAliases,
  getStatusAuthorId,
  getStatusCreatedAtMs,
  getStatusReplyTargetId
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

const getStatusVis = (status: Status): string => {
  const actual = getActualStatus(status)
  return getVisibility(actual.to ?? [], actual.cc ?? [])
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

  const continuesRunAt = (index: number): boolean => {
    if (index < 0 || index >= chain.length - 1) return false
    const current = chain[index]
    const next = chain[index + 1]
    const authorId = getAuthorId(current)
    if (!authorId || getAuthorId(next) !== authorId) return false
    const nextTarget = getReplyTargetId(next)
    if (!nextTarget || !getAliases(current).includes(nextTarget)) {
      return false
    }
    if (getStatusVis(next) !== getStatusVis(current)) return false
    return isWithinGap(getCreatedAtMs(next), getCreatedAtMs(current))
  }

  const runGroupByChainIndex = new Map<number, number>()
  let currentRunGroup = 0
  for (let i = 0; i < chain.length - 1; i++) {
    if (continuesRunAt(i)) {
      runGroupByChainIndex.set(i, currentRunGroup)
    } else {
      currentRunGroup += 1
    }
  }

  const withoutRun = (
    replyingToByReplyId = new Map<string, string>(),
    ancestorRuns: SelfThreadRunBlock[] = [],
    descendantRuns: SelfThreadRunBlock[] = []
  ): SelfThreadModel => ({
    run: null,
    parts: [],
    openedPartIndex: -1,
    mergedIds: new Set<string>(),
    mergedStatuses: [],
    ancestorsOutsideRun: [...ancestors],
    repliesOutsideRun: [...descendants],
    replyingToByReplyId,
    ancestorRuns,
    descendantRuns
  })

  if (runGroupByChainIndex.size === 0) return withoutRun()

  const tuckCandidatesByChainIndex = new Map<number, Status[]>()
  const insetCountByRunGroup = new Map<number, number>()
  const prevCreatedAtByChainIndex = new Map<number, number>()

  const sortedDescendants = descendants
    .map((status, index) => ({
      status,
      index,
      createdAt: getCreatedAtMs(status)
    }))
    .sort(sortIndexedStatuses)

  for (const { status: candidate, createdAt } of sortedDescendants) {
    if (chainIds.has(candidate.id)) continue
    const target = getReplyTargetId(candidate)
    if (!target) continue
    const chainIndex = chainIndexByAlias.get(target)
    if (chainIndex === undefined) continue
    const runGroup = runGroupByChainIndex.get(chainIndex)
    if (runGroup === undefined) continue

    if (chainIndex === 0 && !tuckIntoFirstPart) continue

    const parentStatus = chain[chainIndex]
    if (getAuthorId(candidate) === getAuthorId(parentStatus)) continue
    if (hasChildInDescendants(candidate)) continue
    if (!canTuck(candidate)) continue

    const currentInsets = insetCountByRunGroup.get(runGroup) ?? 0
    if (currentInsets >= COMBINE_MAX_INSETS) continue

    // Measured as `buildCombinedBlocks` does: from the last waiting reply,
    // else from the run post being answered.
    const prevCreatedAt =
      prevCreatedAtByChainIndex.get(chainIndex) ?? getCreatedAtMs(parentStatus)
    if (!isWithinGap(createdAt, prevCreatedAt)) continue

    const list = tuckCandidatesByChainIndex.get(chainIndex) ?? []
    list.push(candidate)
    tuckCandidatesByChainIndex.set(chainIndex, list)
    insetCountByRunGroup.set(runGroup, currentInsets + 1)
    prevCreatedAtByChainIndex.set(chainIndex, createdAt)
  }

  const chronologicalInput: Status[] = []
  for (let i = 0; i < chain.length; i++) {
    chronologicalInput.push(chain[i])
    const tucked = tuckCandidatesByChainIndex.get(i)
    if (tucked) {
      chronologicalInput.push(...tucked)
    }
  }

  const blocks = buildCombinedBlocks(chronologicalInput)
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
    for (let i = 0; i < count - 1; i++) {
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
    return withoutRun(
      getReplyingToLabels(descendants),
      ancestorRuns,
      descendantRuns
    )
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
