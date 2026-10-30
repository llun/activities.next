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
  /**
   * Whether ancestors before the loaded window may be missing (the server
   * only sends a bounded page of them). When true, the replying-to data for
   * the opened post keeps the part it answers but drops the "i of n" numbers,
   * which the unloaded ancestors could change.
   */
  hasMoreAncestors?: boolean
}

export type SelfThreadRunBlock = Extract<CombinedBlock, { kind: 'run' }>

/**
 * A part of an ancestor run (any author) that the focused block replies to:
 * the reply target of the opened post itself when it renders as a plain row,
 * or of the first part of the run holding it (the run as a whole answers that
 * part). `partIndex` is 0-based. Both numbers are null when earlier ancestors
 * were not loaded (`hasMoreAncestors`): the numbering could be wrong, but the
 * part itself still names what the opened post answers.
 */
export interface FocusedReplyingTo {
  status: Status
  partIndex: number | null
  partCount: number | null
}

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
  /** The ancestor-run part the focused block replies to, when there is one. */
  focusedReplyingTo: FocusedReplyingTo | null
  /**
   * For the ancestor run the opened post replies to, keyed by the run's `key`,
   * the 0-based index of that part, so the renderer can keep it visible with
   * `collapseLongRun` when the run is longer than the cap.
   */
  ancestorRunAnchorIndexById: Map<string, number>
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
 *
 * `anchorPartIndex` is a separate keep-visible index — the part the opened
 * post replies to, so an ancestor run longer than the cap never folds the
 * part being answered. It only adds a visible part: it is not the opened
 * part, and no opened-part marker semantics follow from it.
 */
export const collapseLongRun = (
  parts: readonly CombinedPart[],
  openedPartIndex: number,
  maxParts: number = LONG_RUN_MAX_PARTS,
  anchorPartIndex?: number
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
  if (
    anchorPartIndex !== undefined &&
    anchorPartIndex >= 0 &&
    anchorPartIndex < parts.length
  ) {
    indexSet.add(anchorPartIndex)
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
 *
 * The ancestors are structured the same way regardless of who wrote the opened
 * post: every same-author stretch among them that `buildCombinedBlocks` would
 * combine comes back in `ancestorRuns`, a lone post by another author stays a
 * plain row in `ancestorsOutsideRun`, and nothing on the ancestor path — the
 * ancestors or the opened post itself — is ever tucked into a run as an inset.
 * When the focused block (the opened post, or the run holding it) replies to a
 * part of an ancestor run, that part comes back in `focusedReplyingTo` for the
 * renderer's "Replying to" line.
 */
export const buildSelfThreadModel = ({
  focusedStatus,
  ancestors = [],
  descendants = [],
  tuckIntoFirstPart = true,
  hasMoreAncestors = false
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

  // Structure pass over every ancestor (any author), the opened post, its
  // self-replies and the accepted insets. The ancestors and the opened post
  // pass their ids as `neverTuckIds`, so no run can swallow them: every
  // same-author stretch among the ancestors — whoever wrote the opened post —
  // becomes a run of its own, a lone post by another author stays a plain
  // row, and the opened post is never an inset. The accepted insets keep
  // their real tuckability: they were accepted exactly because the timeline
  // tucks them.
  const structureStatuses = [
    ...ancestors,
    focusedStatus,
    ...selfReplyChain,
    ...accepted
  ]
  const neverTuckedIds = new Set(
    [...ancestors, focusedStatus].map((status) => status.id)
  )
  const blocks =
    structureStatuses.length > 1
      ? buildCombinedBlocks(orderLikeTimeline(structureStatuses), {
          neverTuckIds: neverTuckedIds
        })
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

  // The part of an ancestor run that the focused block replies to, for the
  // renderer's "Replying to <name> · i of n" line above the opened post or the
  // focused run's first header. The target is the reply target of the focused
  // block's first post — the opened post itself when it renders as a plain
  // row, or the first part of the run holding it, since the run as a whole
  // answers that part. The part numbers are only reported when every earlier
  // ancestor was loaded: `hasMoreAncestors` keeps the part but drops them.
  const focusedBlockFirstStatus =
    focusedBlock && isRunBlock(focusedBlock)
      ? focusedBlock.parts[0].status
      : focusedStatus
  const focusedTargetId = getReplyTargetId(focusedBlockFirstStatus)
  let focusedReplyingTo: FocusedReplyingTo | null = null
  const ancestorRunAnchorIndexById = new Map<string, number>()
  if (focusedTargetId) {
    for (const runBlock of ancestorRuns) {
      const partIndex = runBlock.parts.findIndex((part) =>
        getAliases(part.status).includes(focusedTargetId)
      )
      if (partIndex < 0) continue
      focusedReplyingTo = {
        status: runBlock.parts[partIndex].status,
        partIndex: hasMoreAncestors ? null : partIndex,
        partCount: hasMoreAncestors ? null : runBlock.parts.length
      }
      ancestorRunAnchorIndexById.set(runBlock.key, partIndex)
      break
    }
  }

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
      descendantRuns,
      focusedReplyingTo,
      ancestorRunAnchorIndexById
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
    descendantRuns,
    focusedReplyingTo,
    ancestorRunAnchorIndexById
  }
}
