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
// limit alone does not bound its work. It visits at most this many replies
// per descendant it may return.
export const DESCENDANTS_VISIT_FACTOR = 3
// How many of one status's replies by the opened status's author are read to
// find the next part of the author's self-thread, and how many replies are
// read below the anonymous depth limit to tell whether there are more.
const SCAN_LIMIT = 5
// The descendant walk reads one status's replies in pages that start at
// FIRST_PAGE and double up to MAX_PAGE.
const FIRST_PAGE = 4
const MAX_PAGE = 64

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
 * is returned if the viewer may see it. The walk visits at most
 * `descendantsLimit * DESCENDANTS_VISIT_FACTOR` replies (every reply it reads
 * counts, including one it has already seen), and for a signed-out viewer
 * stops ANONYMOUS_DESCENDANTS_DEPTH_LIMIT levels down.
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

  // The limit cut the chain and the last ancestor names a parent: there is
  // more when that parent exists and is not one already read (a cycle). Its
  // visibility is not checked, so a hidden parent with visible ones above it
  // still counts; this reveals no more than the reply target already does.
  let hasMoreAncestors = false
  if (parentId && !seenAncestorIds.has(parentId)) {
    const next = await loadParent(parentId)
    hasMoreAncestors = Boolean(next && !seenAncestorIds.has(next.id))
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
  let visitedCount = 0

  // Reserve the author's self-thread: from the opened status, the earliest
  // visible reply by the same author, then the earliest such reply to that
  // one, and so on.
  const reserved: Status[] = []
  const reservedIds = new Set<string>()
  {
    // Ids only, as in the walk below.
    const chainSeen = new Set<string>([status.id])
    let tipId = status.id
    let tipUrl = initialStatusUrl
    // At most one read per part, each of at most SCAN_LIMIT rows; the parts
    // count against the visit budget when the walk below visits them.
    while (
      reserved.length < effectiveDescendantsLimit &&
      reserved.length < maxDepth
    ) {
      const candidates = await database.getStatusReplies({
        statusId: tipId,
        url: tipUrl || undefined,
        ...audience,
        actorId: status.actorId,
        currentActorId: currentActor?.id,
        order: 'asc',
        limit: SCAN_LIMIT
      })
      // Oldest first, in the database's (createdAt, id) order.
      const visible = await keepVisible(candidates)
      const next = visible.find(
        (candidate) =>
          candidate.type !== StatusType.enum.Announce &&
          candidate.actorId === status.actorId &&
          !chainSeen.has(candidate.id)
      )
      if (!next) break
      reserved.push(next)
      reservedIds.add(next.id)
      chainSeen.add(next.id)
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
  // Ids only: decides whether a reply was already walked. Never holds urls,
  // which are author-supplied and may equal another status's id.
  const visitedDescendantIds = new Set<string>([status.id])
  // Every id and url already passed to a replies read, so a url several
  // statuses share is read once, not once per status that carries it.
  const queriedReplyKeys = new Set<string>()
  // The keys to read a status's replies by, leaving out any already read.
  const replyKeys = (id: string, url: string) => {
    const keys = [id, url].filter(
      (key, index, all) =>
        Boolean(key) && !queriedReplyKeys.has(key) && all.indexOf(key) === index
    )
    for (const key of keys) queriedReplyKeys.add(key)
    return keys
  }

  const collect = (reply: Status) => {
    collected.push(reply)
    collectedIds.add(reply.id)
  }

  // A page of one status's replies: their refs (to walk) and the ones the
  // viewer may see, hydrated. Nothing here counts against the visit budget;
  // a ref counts when the walk visits it.
  const readRepliesPage = async (
    targetId: string,
    targetUrl: string,
    offset: number,
    limit: number
  ) => {
    // In the database's (createdAt, id) order, which pages rely on.
    const refs = await database.getStatusReplyRefs({
      statusId: targetId,
      url: targetUrl || undefined,
      offset,
      limit
    })
    const visibleById = new Map<string, Status>()
    if (refs.length > 0) {
      const rows = await database.getStatusReplies({
        statusId: targetId,
        url: targetUrl || undefined,
        ...audience,
        statusIds: refs.map((ref) => ref.id),
        currentActorId: currentActor?.id,
        order: 'asc'
      })
      for (const reply of await keepVisible(rows)) {
        visibleById.set(reply.id, reply)
      }
    }
    return { refs, visibleById }
  }

  // Below the anonymous depth limit nothing is returned; read a few replies
  // only to tell whether there is more.
  const probeBelowDepthLimit = async (targetId: string, targetUrl: string) => {
    const rows = await database.getStatusReplies({
      statusId: targetId,
      url: targetUrl || undefined,
      ...audience,
      currentActorId: currentActor?.id,
      order: 'asc',
      limit: SCAN_LIMIT
    })
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
    // Pages grow from FIRST_PAGE to MAX_PAGE and never exceed what the visit
    // budget has left (plus one, to see that more exist), so a leaf costs one
    // small read and a wide status does not read rows the walk cannot visit.
    let offset = 0
    let pageSize = FIRST_PAGE
    while (!stopped) {
      const limit = Math.min(
        pageSize,
        MAX_PAGE,
        Math.max(0, visitCap - visitedCount) + 1
      )
      const { refs, visibleById } = await readRepliesPage(
        targetId,
        targetUrl,
        offset,
        limit
      )
      offset += refs.length
      for (const ref of refs) {
        if (stopped) return
        if (visitedCount >= visitCap) {
          // A reply the visit budget does not reach; everything collected so
          // far comes before it in pre-order.
          hasMoreDescendants = true
          stopped = true
          return
        }
        // Every reply read counts, one already walked too (a cycle, or a url
        // two statuses share), so repeats cannot outrun the budget.
        visitedCount++
        if (visitedDescendantIds.has(ref.id)) continue
        visitedDescendantIds.add(ref.id)
        const reply = visibleById.get(ref.id)
        const replyUrl = reply ? getStatusUrl(reply) : ''

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

        const [key, otherKey = ''] = replyKeys(
          ref.id,
          replyUrl || ref.url || ''
        )
        if (!key) continue
        if (depth + 1 >= maxDepth) {
          if (!hasMoreDescendants) await probeBelowDepthLimit(key, otherKey)
          continue
        }
        await walk(key, otherKey, depth + 1)
      }
      if (refs.length < limit) return
      pageSize *= 2
    }
  }

  if (effectiveDescendantsLimit > 0) {
    const [key, otherKey = ''] = replyKeys(status.id, initialStatusUrl)
    await walk(key, otherKey, 0)
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
