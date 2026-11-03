import { Database } from '@/lib/database/types'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import {
  filterReadableStatuses,
  getReadableStatus
} from '@/lib/services/statusRouteAccess'
import { filterBlockedStatuses } from '@/lib/services/timelines/blockFilter'
import { filterDomainBlockedStatuses } from '@/lib/services/timelines/domainBlockFilter'
import { filterMutedStatuses } from '@/lib/services/timelines/muteFilter'
import { Actor } from '@/lib/types/domain/actor'
import {
  Status,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { isPublicId } from '@/lib/utils/publicId'

export const AUTHENTICATED_CONTEXT_LIMIT = 4096
export const ANONYMOUS_ANCESTORS_LIMIT = 40
export const ANONYMOUS_DESCENDANTS_LIMIT = 60
// Mastodon's ANONYMOUS_DESCENDANTS_DEPTH_LIMIT: a signed-out reader gets the
// replies at most this many levels below the opened status.
export const ANONYMOUS_DESCENDANTS_DEPTH_LIMIT = 20
// The descendant walk steps through replies it may not show (a muted author,
// a followers-only reply) to reach the replies under them, so the descendants
// limit alone does not bound its work. It reads at most this many reply rows
// per descendant it may return.
export const DESCENDANTS_VISIT_FACTOR = 3
// How many of one status's replies by the opened status's author are read to
// find the next part of the author's self-thread, and how many replies are
// read below the anonymous depth limit to tell whether there are more.
const SCAN_LIMIT = 5

export interface GetStatusContextParams {
  database: Database
  statusId: string
  status?: Status | null
  currentActor?: Actor | null
  ancestorsLimit?: number
  descendantsLimit?: number
}

export interface StatusContextResult {
  status: Status | null
  ancestors: Status[]
  descendants: Status[]
  hasMoreAncestors: boolean
  hasMoreDescendants: boolean
}

const toTimestampMs = (value: unknown): number => {
  if (value === null || value === undefined) return 0
  const time = new Date(value as string | number | Date).getTime()
  return Number.isNaN(time) ? 0 : time
}

const compareReplyOrder = (
  a: { createdAt: unknown; id: string },
  b: { createdAt: unknown; id: string }
): number => {
  const timeDiff = toTimestampMs(a.createdAt) - toTimestampMs(b.createdAt)
  if (timeDiff !== 0) return timeDiff
  return a.id.localeCompare(b.id)
}

const getReplyTarget = (status: Status): string =>
  status.type === StatusType.enum.Announce ? '' : status.reply

export const getStatusUrl = (status: Status): string => {
  return getOriginalStatus(status).url
}

/**
 * Shared thread context service used by both the Mastodon API context route
 * and the native status thread page.
 *
 * Traverses ancestors (root-to-parent) and descendants (depth-first pre-order
 * sorted deterministically by createdAt, id) with access control and cycle
 * protection.
 *
 * Every status is filtered on its own, as Mastodon does: a reply the viewer
 * may not see (unreadable, blocked, muted, or from a domain the viewer
 * blocked) is left out, but the replies under it are still walked and each
 * is returned if the viewer may see it. The walk reads at most
 * `descendantsLimit * DESCENDANTS_VISIT_FACTOR` reply rows, and for a
 * signed-out viewer stops ANONYMOUS_DESCENDANTS_DEPTH_LIMIT levels down.
 *
 * Before the depth-first fill, the opened status's author's own self-thread
 * (each part the earliest visible reply by that author to the previous part)
 * is reserved, so earlier side branches cannot crowd it out of the limit. The
 * reservation decides which statuses are returned, never their order.
 */
export async function getStatusContext({
  database,
  statusId,
  status: initialStatus,
  currentActor,
  ancestorsLimit,
  descendantsLimit
}: GetStatusContextParams): Promise<StatusContextResult> {
  let status = initialStatus ?? null

  if (!status) {
    const resolvedStatusId = await resolveStatusIdParam(database, statusId)

    status = await getReadableStatus({
      database,
      statusId: resolvedStatusId,
      currentActor: currentActor ?? null
    })

    if (!status && isPublicId(statusId)) {
      const byPublicId = await database.getStatusFromPublicId({
        publicId: statusId,
        currentActorId: currentActor?.id
      })
      if (
        byPublicId &&
        (await canActorReadStatus({
          database,
          status: byPublicId,
          currentActor: currentActor ?? null
        }))
      ) {
        status = byPublicId
      }
    }

    if (!status) {
      const byRawId = await database.getStatus({
        statusId,
        currentActorId: currentActor?.id,
        withReplies: false
      })
      if (
        byRawId &&
        (await canActorReadStatus({
          database,
          status: byRawId,
          currentActor: currentActor ?? null
        }))
      ) {
        status = byRawId
      }
    }
  }

  if (!status || status.type === StatusType.enum.Announce) {
    return {
      status: null,
      ancestors: [],
      descendants: [],
      hasMoreAncestors: false,
      hasMoreDescendants: false
    }
  }

  const viewer = currentActor ?? null
  // User-level domain blocks, read once for both directions (as the timelines
  // do in getFilteredTimelinePage).
  const blockedDomains = new Set(
    currentActor
      ? (await database.getActorDomainBlocks({ actorId: currentActor.id })).map(
          (block) => block.domain
        )
      : []
  )
  const keepVisible = async (statuses: Status[]): Promise<Status[]> => {
    if (statuses.length === 0) return statuses
    let visible = await filterReadableStatuses({
      database,
      statuses,
      currentActor: viewer
    })
    if (currentActor) {
      visible = filterDomainBlockedStatuses(blockedDomains, visible)
      visible = await filterBlockedStatuses(database, currentActor.id, visible)
      visible = await filterMutedStatuses(database, currentActor.id, visible)
    }
    return visible
  }

  const defaultAncestorsLimit = currentActor
    ? AUTHENTICATED_CONTEXT_LIMIT
    : ANONYMOUS_ANCESTORS_LIMIT
  const effectiveAncestorsLimit = ancestorsLimit ?? defaultAncestorsLimit

  const chain: Status[] = []
  const initialStatusUrl = getStatusUrl(status)
  const seenAncestorIds = new Set<string>([status.id])
  if (initialStatusUrl) seenAncestorIds.add(initialStatusUrl)

  const loadParent = async (parentId: string): Promise<Status | null> => {
    const parent = await database.getStatus({
      statusId: parentId,
      withReplies: false,
      currentActorId: currentActor?.id
    })
    if (parent) return parent
    const resolvedParentId = await resolveStatusIdParam(database, parentId)
    if (resolvedParentId === parentId) return null
    return database.getStatus({
      statusId: resolvedParentId,
      withReplies: false,
      currentActorId: currentActor?.id
    })
  }

  let parentId = getReplyTarget(status)

  while (parentId && chain.length < effectiveAncestorsLimit) {
    if (seenAncestorIds.has(parentId)) {
      parentId = ''
      break
    }

    const parent = await loadParent(parentId)
    if (!parent || seenAncestorIds.has(parent.id)) {
      parentId = ''
      break
    }
    seenAncestorIds.add(parent.id)
    const parentUrl = getStatusUrl(parent)
    if (parentUrl) seenAncestorIds.add(parentUrl)
    seenAncestorIds.add(parentId)

    chain.push(parent)
    parentId = getReplyTarget(parent)
  }

  // The chain is full and names a further parent: there is more only if that
  // parent exists, is not one already read, and the viewer may see it.
  let hasMoreAncestors = false
  if (parentId && !seenAncestorIds.has(parentId)) {
    const next = await loadParent(parentId)
    hasMoreAncestors = Boolean(
      next &&
      !seenAncestorIds.has(next.id) &&
      (await keepVisible([next])).length > 0
    )
  }

  const ancestors = (await keepVisible(chain)).reverse()

  const defaultDescendantsLimit = currentActor
    ? AUTHENTICATED_CONTEXT_LIMIT
    : ANONYMOUS_DESCENDANTS_LIMIT
  const effectiveDescendantsLimit = Math.max(
    0,
    Math.floor(descendantsLimit ?? defaultDescendantsLimit)
  )
  const maxDepth = currentActor
    ? Number.POSITIVE_INFINITY
    : ANONYMOUS_DESCENDANTS_DEPTH_LIMIT
  const visitCap = effectiveDescendantsLimit * DESCENDANTS_VISIT_FACTOR
  // The SQL scope of what the viewer may read; keepVisible is the per-status
  // check on top of it.
  const audience = currentActor
    ? { visibleToActorId: currentActor.id }
    : { publicOnly: true }
  let rowsRead = 0

  const markSeen = (seen: Set<string>, id: string, url?: string | null) => {
    seen.add(id)
    if (url) seen.add(url)
  }

  // Reserve the author's self-thread: from the opened status, the earliest
  // visible reply by the same author, then the earliest such reply to that
  // one, and so on.
  const reserved: Status[] = []
  const reservedIds = new Set<string>()
  {
    const chainSeen = new Set<string>()
    markSeen(chainSeen, status.id, initialStatusUrl)
    let tipId = status.id
    let tipUrl = initialStatusUrl
    while (
      reserved.length < effectiveDescendantsLimit &&
      reserved.length < maxDepth &&
      rowsRead < visitCap
    ) {
      const candidates = await database.getStatusReplies({
        statusId: tipId,
        url: tipUrl || undefined,
        ...audience,
        actorId: status.actorId,
        currentActorId: currentActor?.id,
        order: 'asc',
        limit: Math.min(SCAN_LIMIT, visitCap - rowsRead)
      })
      rowsRead += candidates.length
      const visible = (await keepVisible(candidates)).sort(compareReplyOrder)
      const next = visible.find(
        (candidate) =>
          candidate.type !== StatusType.enum.Announce &&
          candidate.actorId === status.actorId &&
          !chainSeen.has(candidate.id)
      )
      if (!next) break
      reserved.push(next)
      reservedIds.add(next.id)
      markSeen(chainSeen, next.id, getStatusUrl(next))
      tipId = next.id
      tipUrl = getStatusUrl(next)
    }
  }

  const collected: Status[] = []
  const collectedIds = new Set<string>()
  const othersLimit = effectiveDescendantsLimit - reserved.length
  let othersCollected = 0
  let hasMoreDescendants = false
  let stopped = false
  const visitedDescendantIds = new Set<string>()
  markSeen(visitedDescendantIds, status.id, initialStatusUrl)

  const collect = (reply: Status) => {
    collected.push(reply)
    collectedIds.add(reply.id)
  }

  // One status's replies within the remaining visit budget: their refs (to
  // walk), and the ones the viewer may see, hydrated. `overflow` means it has
  // more replies than the budget lets the walk visit.
  const readReplies = async (targetId: string, targetUrl: string) => {
    const remaining = Math.max(0, visitCap - rowsRead)
    const refs = await database.getStatusReplyRefs({
      statusId: targetId,
      url: targetUrl || undefined,
      limit: remaining + 1
    })
    const overflow = refs.length > remaining
    const kept = (overflow ? refs.slice(0, remaining) : refs).sort(
      compareReplyOrder
    )
    rowsRead += kept.length
    const visibleById = new Map<string, Status>()
    if (kept.length > 0) {
      const keptIds = new Set(kept.map((ref) => ref.id))
      // Same order as the refs, so the visible rows among the first
      // `kept.length` refs are within the first `kept.length` readable rows.
      const rows = await database.getStatusReplies({
        statusId: targetId,
        url: targetUrl || undefined,
        ...audience,
        currentActorId: currentActor?.id,
        order: 'asc',
        limit: kept.length
      })
      for (const reply of await keepVisible(
        rows.filter((row) => keptIds.has(row.id))
      )) {
        visibleById.set(reply.id, reply)
      }
    }
    return { kept, visibleById, overflow }
  }

  // Below the anonymous depth limit nothing is returned; read a few replies
  // only to tell whether there is more.
  const probeBelowDepthLimit = async (targetId: string, targetUrl: string) => {
    const remaining = visitCap - rowsRead
    if (remaining <= 0) {
      hasMoreDescendants = true
      return
    }
    const rows = await database.getStatusReplies({
      statusId: targetId,
      url: targetUrl || undefined,
      ...audience,
      currentActorId: currentActor?.id,
      order: 'asc',
      limit: Math.min(SCAN_LIMIT, remaining)
    })
    rowsRead += rows.length
    const visible = await keepVisible(rows)
    if (visible.some((reply) => !visitedDescendantIds.has(reply.id))) {
      hasMoreDescendants = true
    }
  }

  const walk = async (
    targetId: string,
    targetUrl: string,
    depth: number
  ): Promise<void> => {
    const { kept, visibleById, overflow } = await readReplies(
      targetId,
      targetUrl
    )
    for (const ref of kept) {
      if (stopped) return
      const reply = visibleById.get(ref.id)
      const replyUrl = reply ? getStatusUrl(reply) : ''
      // Skipped by id only, as before: ids and urls share the set (a parent
      // is named by either), and two statuses may share a url.
      if (visitedDescendantIds.has(ref.id)) continue
      markSeen(visitedDescendantIds, ref.id, ref.url)
      if (replyUrl) visitedDescendantIds.add(replyUrl)

      if (reply) {
        if (reservedIds.has(reply.id)) {
          collect(reply)
        } else if (othersCollected < othersLimit) {
          collect(reply)
          othersCollected++
        } else {
          // A visible reply the limit leaves out.
          hasMoreDescendants = true
          stopped = true
          return
        }
      }

      const nextUrl = replyUrl || ref.url || ''
      if (depth + 1 >= maxDepth) {
        if (!hasMoreDescendants) await probeBelowDepthLimit(ref.id, nextUrl)
        continue
      }
      await walk(ref.id, nextUrl, depth + 1)
    }
    if (overflow && !stopped) {
      // Replies the visit budget does not reach; everything collected so far
      // comes before them in pre-order.
      hasMoreDescendants = true
      stopped = true
    }
  }

  if (effectiveDescendantsLimit > 0) {
    await walk(status.id, initialStatusUrl, 0)
  }

  // Reserved parts the walk stopped before reaching all come after the point
  // it stopped at, in chain order, which is their pre-order too.
  for (const part of reserved) {
    if (!collectedIds.has(part.id)) collect(part)
  }

  return {
    status,
    ancestors,
    descendants: collected,
    hasMoreAncestors,
    hasMoreDescendants
  }
}
