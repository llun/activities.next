import { Database } from '@/lib/database/types'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import {
  filterReadableStatuses,
  getReadableStatus
} from '@/lib/services/statusRouteAccess'
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

  const defaultAncestorsLimit = currentActor
    ? AUTHENTICATED_CONTEXT_LIMIT
    : ANONYMOUS_ANCESTORS_LIMIT
  const effectiveAncestorsLimit = ancestorsLimit ?? defaultAncestorsLimit

  const chain: Status[] = []
  const initialStatusUrl = getStatusUrl(status)
  const seenAncestorIds = new Set<string>([status.id])
  if (initialStatusUrl) seenAncestorIds.add(initialStatusUrl)

  let parentId = getReplyTarget(status)
  let hasMoreAncestors = false

  while (parentId && chain.length < effectiveAncestorsLimit) {
    if (seenAncestorIds.has(parentId)) break

    let parent = await database.getStatus({
      statusId: parentId,
      withReplies: false,
      currentActorId: currentActor?.id
    })
    if (!parent) {
      const resolvedParentId = await resolveStatusIdParam(database, parentId)
      if (resolvedParentId !== parentId) {
        parent = await database.getStatus({
          statusId: resolvedParentId,
          withReplies: false,
          currentActorId: currentActor?.id
        })
      }
    }
    if (!parent) break

    if (seenAncestorIds.has(parent.id)) break
    seenAncestorIds.add(parent.id)
    const parentUrl = getStatusUrl(parent)
    if (parentUrl) seenAncestorIds.add(parentUrl)
    seenAncestorIds.add(parentId)

    chain.push(parent)
    parentId = getReplyTarget(parent)
  }

  if (parentId && chain.length >= effectiveAncestorsLimit) {
    hasMoreAncestors = true
  }

  const readableAncestors = await filterReadableStatuses({
    database,
    statuses: chain,
    currentActor: currentActor ?? null
  })
  const ancestors = readableAncestors.reverse()

  const defaultDescendantsLimit = currentActor
    ? AUTHENTICATED_CONTEXT_LIMIT
    : ANONYMOUS_DESCENDANTS_LIMIT
  const effectiveDescendantsLimit = descendantsLimit ?? defaultDescendantsLimit

  const collected: Status[] = []
  const visitedDescendantIds = new Set<string>([status.id])
  if (status.url) visitedDescendantIds.add(status.url)
  let hasMoreDescendants = false

  const expand = async (
    targetId: string,
    targetUrl?: string
  ): Promise<void> => {
    if (collected.length >= effectiveDescendantsLimit) {
      hasMoreDescendants = true
      return
    }

    const replies = await database.getStatusReplies({
      statusId: targetId,
      url: targetUrl,
      ...(currentActor
        ? { visibleToActorId: currentActor.id }
        : { publicOnly: true }),
      currentActorId: currentActor?.id,
      order: 'asc'
    })

    const readableReplies = await filterReadableStatuses({
      database,
      statuses: replies,
      currentActor: currentActor ?? null
    })

    readableReplies.sort((a, b) => {
      const timeDiff = (a.createdAt ?? 0) - (b.createdAt ?? 0)
      if (timeDiff !== 0) return timeDiff
      return a.id.localeCompare(b.id)
    })

    for (const reply of readableReplies) {
      if (collected.length >= effectiveDescendantsLimit) {
        hasMoreDescendants = true
        return
      }
      if (visitedDescendantIds.has(reply.id)) continue
      visitedDescendantIds.add(reply.id)
      const replyUrl = getStatusUrl(reply)
      if (replyUrl) visitedDescendantIds.add(replyUrl)
      collected.push(reply)
      await expand(reply.id, replyUrl)
    }
  }

  await expand(status.id, initialStatusUrl)

  return {
    status,
    ancestors,
    descendants: collected,
    hasMoreAncestors,
    hasMoreDescendants
  }
}
