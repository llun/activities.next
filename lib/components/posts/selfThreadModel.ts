import { Status, StatusType } from '@/lib/types/domain/status'
import { getVisibility } from '@/lib/utils/getVisibility'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import {
  COMBINE_MAX_GAP_MS,
  COMBINE_MAX_INSETS,
  CombinedBlock,
  CombinedPart,
  buildCombinedBlocks
} from './combinedThreadModel'
import {
  getStatusAliases,
  getStatusAuthorId,
  getStatusCreatedAtMs,
  getStatusReplyTargetId
} from './timelineModel'

export { COMBINE_MAX_GAP_MS, COMBINE_MAX_INSETS }
export type { CombinedBlock, CombinedPart }

export const LONG_RUN_MAX_PARTS = 6

export interface LongRunCollapseGap {
  afterPartIndex: number
  count: number
  label: string
}

export interface LongRunCollapseResult {
  isCollapsed: boolean
  visiblePartIndices: number[]
  visibleParts: CombinedPart[]
  collapsedCount: number
  collapseLabel: string | null
  gaps: LongRunCollapseGap[]
}

export interface BuildSelfThreadParams {
  focusedStatus: Status
  ancestors?: readonly Status[]
  descendants?: readonly Status[]
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

export interface FitnessSelfThreadModel extends SelfThreadModel {
  followUpParts: CombinedPart[]
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

const isTuckableNote = (status: Status): boolean => {
  const actual = getActualStatus(status)
  return (
    actual.type === StatusType.enum.Note &&
    Array.isArray(actual.attachments) &&
    actual.attachments.length === 0 &&
    !actual.fitness &&
    !actual.quote
  )
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
      visiblePartIndices: parts.map((_, index) => index),
      visibleParts: [...parts],
      collapsedCount: 0,
      collapseLabel: null,
      gaps: []
    }
  }

  const indexSet = new Set<number>([0, 1, parts.length - 1])
  if (openedPartIndex > 1 && openedPartIndex < parts.length - 1) {
    indexSet.add(openedPartIndex)
  }
  const visiblePartIndices = [...indexSet].sort((a, b) => a - b)
  const visibleParts = visiblePartIndices.map((index) => parts[index])
  const collapsedCount = parts.length - visiblePartIndices.length
  const gaps: LongRunCollapseGap[] = []
  for (let i = 0; i < visiblePartIndices.length - 1; i++) {
    const afterPartIndex = visiblePartIndices[i]
    const count = visiblePartIndices[i + 1] - afterPartIndex - 1
    if (count > 0) {
      gaps.push({
        afterPartIndex,
        count,
        label: formatLongRunCollapseLabel(count)
      })
    }
  }

  return {
    isCollapsed: true,
    visiblePartIndices,
    visibleParts,
    collapsedCount,
    collapseLabel: formatLongRunCollapseLabel(collapsedCount),
    gaps
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
  descendants = []
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
    return (
      Math.abs(getCreatedAtMs(next) - getCreatedAtMs(current)) <=
      COMBINE_MAX_GAP_MS
    )
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

  if (runGroupByChainIndex.size === 0) {
    return {
      run: null,
      parts: [],
      openedPartIndex: -1,
      mergedIds: new Set<string>(),
      mergedStatuses: [],
      ancestorsOutsideRun: [...ancestors],
      repliesOutsideRun: [...descendants],
      replyingToByReplyId: new Map<string, string>(),
      ancestorRuns: [],
      descendantRuns: []
    }
  }

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

    const parentStatus = chain[chainIndex]
    const nextChainStatus = chain[chainIndex + 1]
    if (getAuthorId(candidate) === getAuthorId(parentStatus)) continue
    if (hasChildInDescendants(candidate)) continue
    if (!isTuckableNote(candidate)) continue

    const parentCreatedAt = getCreatedAtMs(parentStatus)
    const nextCreatedAt = getCreatedAtMs(nextChainStatus)
    if (createdAt < parentCreatedAt || createdAt > nextCreatedAt) continue

    const currentInsets = insetCountByRunGroup.get(runGroup) ?? 0
    if (currentInsets >= COMBINE_MAX_INSETS) continue

    const prevCreatedAt =
      prevCreatedAtByChainIndex.get(chainIndex) ?? parentCreatedAt
    if (Math.abs(createdAt - prevCreatedAt) > COMBINE_MAX_GAP_MS) continue

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

  if (!focusedBlock || focusedBlock.kind !== 'run') {
    const replyingToByReplyId = new Map<string, string>()
    for (const reply of descendants) {
      const target = getReplyTargetId(reply)
      if (!target) continue
      const match = earlierPartByAlias.get(target)
      if (match) {
        replyingToByReplyId.set(
          reply.id,
          `Replying to ${match.partIndex + 1} of ${match.numParts}`
        )
      }
    }

    return {
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

  const replyingToByReplyId = new Map<string, string>()
  for (const reply of repliesOutsideRun) {
    const target = getReplyTargetId(reply)
    if (!target) continue
    const match = earlierPartByAlias.get(target)
    if (match) {
      replyingToByReplyId.set(
        reply.id,
        `Replying to ${match.partIndex + 1} of ${match.numParts}`
      )
    }
  }

  return {
    run: focusedBlock,
    parts,
    openedPartIndex,
    mergedIds,
    mergedStatuses,
    ancestorsOutsideRun,
    repliesOutsideRun,
    replyingToByReplyId,
    ancestorRuns,
    descendantRuns
  }
}

/**
 * Builds the self-thread model for a fitness activity detail page, where Part 1
 * is rendered by the fitness hero card (`ActivityPostFrame`) and `followUpParts`
 * (`parts.slice(1)`) are rendered in the follow-up notes card below the charts.
 */
export const buildFitnessSelfThreadModel = (
  activityStatus: Status,
  descendants: readonly Status[] = []
): FitnessSelfThreadModel => {
  const model = buildSelfThreadModel({
    focusedStatus: activityStatus,
    ancestors: [],
    descendants
  })
  return {
    ...model,
    followUpParts: model.parts.slice(1)
  }
}
