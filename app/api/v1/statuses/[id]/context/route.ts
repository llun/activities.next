import { Database } from '@/lib/database/types'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import {
  filterReadableStatuses,
  getReadableStatus
} from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Mirror Mastodon's context limits: authenticated requests can walk a much
// larger thread than anonymous ones (see Api::V1::Statuses::ContextsController).
const AUTHENTICATED_CONTEXT_LIMIT = 4096
const ANONYMOUS_ANCESTORS_LIMIT = 40
const ANONYMOUS_DESCENDANTS_LIMIT = 60

interface Params {
  id: string
}

const getReplyId = (status: Status): string =>
  status.type === StatusType.enum.Announce ? '' : status.reply

/**
 * Walks the `in_reply_to` chain from the status up to the thread root. The walk
 * traverses through statuses the requester cannot read (so the chain is not cut
 * short by a private ancestor), but only readable ancestors are returned. The
 * result is ordered root-first, matching Mastodon's `ancestors` ordering.
 */
const collectAncestors = async ({
  database,
  status,
  currentActor,
  limit
}: {
  database: Database
  status: Status
  currentActor: Actor | null
  limit: number
}): Promise<Status[]> => {
  const chain: Status[] = []
  const seen = new Set<string>([status.id])
  let parentId = getReplyId(status)

  while (parentId && chain.length < limit) {
    const parent = await database.getStatus({
      statusId: parentId,
      withReplies: false,
      currentActorId: currentActor?.id
    })
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    chain.push(parent)
    parentId = getReplyId(parent)
  }

  // chain is direct-parent-first; reverse to root-first for the response.
  const readable = await filterReadableStatuses({
    database,
    statuses: chain,
    currentActor
  })
  return readable.reverse()
}

/**
 * Depth-first pre-order traversal of the reply tree under the status, matching
 * Mastodon's flattened `descendants` ordering. Readability is filtered *during*
 * expansion (not after) so only readable replies count toward `limit` and the
 * traversal never recurses into — or leaks the structure of — unreadable
 * branches.
 */
const collectDescendants = async ({
  database,
  rootStatusId,
  currentActor,
  excludedIds,
  limit
}: {
  database: Database
  rootStatusId: string
  currentActor: Actor | null
  excludedIds: Set<string>
  limit: number
}): Promise<Status[]> => {
  const collected: Status[] = []
  const visited = new Set<string>(excludedIds)

  const expand = async (parentId: string): Promise<void> => {
    if (collected.length >= limit) return
    const replies = await database.getStatusReplies({
      statusId: parentId,
      visibleToActorId: currentActor?.id ?? null
    })
    // getStatusReplies pre-filters by coarse visibility; apply the precise
    // per-actor readable check before a reply counts toward the limit or is
    // recursed into.
    const readableReplies = await filterReadableStatuses({
      database,
      statuses: replies,
      currentActor
    })
    for (const reply of readableReplies) {
      if (collected.length >= limit) return
      if (visited.has(reply.id)) continue
      visited.add(reply.id)
      collected.push(reply)
      await expand(reply.id)
    }
  }

  await expand(rootStatusId)

  return collected
}

export const GET = traceApiRoute(
  'getStatusContext',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      const { database, currentActor } = context
      const statusId = idToUrl(encodedStatusId)

      const status = await getReadableStatus({
        database,
        statusId,
        currentActor
      })
      if (!status || status.type === StatusType.enum.Announce) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const ancestorsLimit = currentActor
        ? AUTHENTICATED_CONTEXT_LIMIT
        : ANONYMOUS_ANCESTORS_LIMIT
      const descendantsLimit = currentActor
        ? AUTHENTICATED_CONTEXT_LIMIT
        : ANONYMOUS_DESCENDANTS_LIMIT

      const [ancestorStatuses, descendantStatuses] = await Promise.all([
        collectAncestors({
          database,
          status,
          currentActor,
          limit: ancestorsLimit
        }),
        collectDescendants({
          database,
          rootStatusId: statusId,
          currentActor,
          excludedIds: new Set<string>([statusId]),
          limit: descendantsLimit
        })
      ])

      const [ancestors, descendants] = await Promise.all([
        getMastodonStatuses(database, ancestorStatuses, currentActor?.id),
        getMastodonStatuses(database, descendantStatuses, currentActor?.id)
      ])

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          ancestors,
          descendants
        }
      })
    },
    // A token scoped read:statuses OR read satisfies the requirement.
    { matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
