import { Status, StatusType } from '@/lib/types/domain/status'
import { getVisibility } from '@/lib/utils/getVisibility'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import {
  getStatusAliases,
  getStatusAuthorId,
  getStatusCreatedAtMs,
  getStatusReplyTargetId
} from './timelineModel'

/**
 * The longest gap between two neighbouring posts of a combined run. Exactly ten
 * minutes still combines; one millisecond more starts a new block.
 */
export const COMBINE_MAX_GAP_MS = 10 * 60 * 1000

/** Other people's replies a run may carry inside it before it is split. */
export const COMBINE_MAX_INSETS = 2

/** One post by the run's author, with the other people's replies tucked under it. */
export interface CombinedPart {
  status: Status
  insets: Status[]
}

export type CombinedBlock =
  | { kind: 'post'; status: Status }
  | { kind: 'run'; key: string; parts: CombinedPart[] }

interface StatusInfo {
  status: Status
  authorId: string
  createdAt: number
  parentId: string | null
  visibility: string
  /** A reply a run may carry as an inset: a bare note, nothing to show but text. */
  canTuck: boolean
}

interface PendingInset {
  info: StatusInfo
  partIndex: number
  /** Position of the reply in the statuses, to rescan from if the run splits. */
  index: number
}

interface RunDraft {
  authorId: string
  visibility: string
  parts: { info: StatusInfo; insets: StatusInfo[] }[]
  /** Replies seen since the last author post, kept only if the author continues. */
  pending: PendingInset[]
}

const isWithinGap = (a: number, b: number) =>
  Math.abs(a - b) <= COMBINE_MAX_GAP_MS

/**
 * A post can sit inside a run as an inset when the inset can show all of it:
 * text and a link card, but no media, poll, quote or fitness activity.
 */
const canTuck = (status: Status): boolean => {
  const actual = getActualStatus(status)
  return (
    actual.type === StatusType.enum.Note &&
    actual.attachments.length === 0 &&
    !actual.fitness &&
    !actual.quote
  )
}

/**
 * Splits the chain-ordered statuses of a thread or conversation row into
 * blocks: a `run` is a stretch of quick self-replies that the timeline shows as
 * one combined post, and every other status stays a plain `post`.
 *
 * A run is two or more posts by one author where each post after the first
 * replies to the previous one (or to a reply tucked into the run), neighbouring
 * posts are at most `COMBINE_MAX_GAP_MS` apart and all share one visibility.
 * Someone else's reply to a run post stays inside the run as an inset when the
 * run carries at most `COMBINE_MAX_INSETS` of them, the reply has nothing but
 * text and the author's next post follows it; otherwise the run splits there and
 * those replies are looked at again, each one free to start a run of its own.
 */
export const buildCombinedBlocks = (
  statuses: readonly Status[]
): CombinedBlock[] => {
  const aliasToId = new Map<string, string>()
  for (const status of statuses) {
    for (const alias of getStatusAliases(getActualStatus(status))) {
      aliasToId.set(alias, status.id)
    }
  }

  const infoOf = (status: Status): StatusInfo => {
    const actual = getActualStatus(status)
    const replyTarget = getStatusReplyTargetId(actual)
    const parentId = replyTarget ? (aliasToId.get(replyTarget) ?? null) : null
    return {
      status,
      authorId: getStatusAuthorId(actual),
      createdAt: getStatusCreatedAtMs(actual),
      parentId: parentId === status.id ? null : parentId,
      visibility: getVisibility(actual.to, actual.cc),
      canTuck: canTuck(status)
    }
  }

  const blocks: CombinedBlock[] = []
  let run: RunDraft | null = null

  const startRun = (info: StatusInfo): RunDraft => ({
    authorId: info.authorId,
    visibility: info.visibility,
    parts: [{ info, insets: [] }],
    pending: []
  })

  /**
   * Emits the open run. Replies still pending were never followed up on by the
   * author, so they are not part of it: the index of the first one is returned
   * and the caller scans again from there, so each can start a run of its own.
   */
  const closeRun = (): number | null => {
    if (!run) return null
    if (run.parts.length >= 2) {
      blocks.push({
        kind: 'run',
        key: `combined:${run.parts[0].info.status.id}`,
        parts: run.parts.map((part) => ({
          status: part.info.status,
          insets: part.insets.map((inset) => inset.status)
        }))
      })
    } else {
      blocks.push({ kind: 'post', status: run.parts[0].info.status })
    }
    const rewindTo = run.pending.length ? run.pending[0].index : null
    run = null
    return rewindTo
  }

  const infos = statuses.map(infoOf)
  let index = 0
  for (;;) {
    if (index >= infos.length) {
      const rewindTo = closeRun()
      if (rewindTo === null) break
      index = rewindTo
      continue
    }

    const info = infos[index]
    if (!run) {
      run = startRun(info)
      index += 1
      continue
    }

    const last = run.parts[run.parts.length - 1].info
    const previous = run.pending.length
      ? run.pending[run.pending.length - 1].info
      : last

    if (info.authorId === run.authorId) {
      const repliesToRun =
        info.parentId !== null &&
        (info.parentId === last.status.id ||
          run.pending.some(({ info: p }) => p.status.id === info.parentId) ||
          run.parts.some((part) =>
            part.insets.some((inset) => inset.status.id === info.parentId)
          ))
      if (
        repliesToRun &&
        info.visibility === run.visibility &&
        isWithinGap(info.createdAt, previous.createdAt)
      ) {
        for (const { info: pending, partIndex } of run.pending) {
          run.parts[partIndex].insets.push(pending)
        }
        run.pending = []
        run.parts.push({ info, insets: [] })
        index += 1
        continue
      }
    } else if (info.parentId !== null && info.canTuck) {
      const partIndex = run.parts.findIndex(
        (part) => part.info.status.id === info.parentId
      )
      const insetCount =
        run.pending.length +
        run.parts.reduce((total, part) => total + part.insets.length, 0)
      if (
        partIndex >= 0 &&
        insetCount < COMBINE_MAX_INSETS &&
        isWithinGap(info.createdAt, previous.createdAt)
      ) {
        run.pending.push({ info, partIndex, index })
        index += 1
        continue
      }
    }

    const rewindTo = closeRun()
    if (rewindTo !== null) {
      index = rewindTo
      continue
    }
    run = startRun(info)
    index += 1
  }

  return blocks
}

/** Whether any block is a combined run (otherwise the row renders as before). */
export const hasCombinedRun = (blocks: readonly CombinedBlock[]): boolean =>
  blocks.some((block) => block.kind === 'run')
