import { z } from 'zod'

import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { getRemoteActorStatuses } from '@/lib/services/mastodon/getRemoteActorStatuses'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Scope } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { type Status, StatusType } from '@/lib/types/domain/status'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, safeIdToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const MAX_STATUS_SCAN_BATCHES = 10

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const StatusQueryParams = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: clampedLimit(40, 20),
  only_media: z
    .enum(['true', 'false', '1', '0'])
    .transform((val) => val === 'true' || val === '1')
    .optional(),
  exclude_replies: z
    .enum(['true', 'false', '1', '0'])
    .transform((val) => val === 'true' || val === '1')
    .optional(),
  exclude_reblogs: z
    .enum(['true', 'false', '1', '0'])
    .transform((val) => val === 'true' || val === '1')
    .optional(),
  pinned: z
    .enum(['true', 'false', '1', '0'])
    .transform((val) => val === 'true' || val === '1')
    .optional(),
  tagged: z.string().optional()
})

export const GET = traceApiRoute(
  'getAccountStatuses',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)
      const id = idToUrl(encodedAccountId)

      const actor = await database.getActorFromId({ id })
      if (!actor) return apiCorsError(req, CORS_HEADERS, 404)

      const url = new URL(req.url)
      const queryParams = Object.fromEntries(url.searchParams.entries())
      const parsed = StatusQueryParams.safeParse(queryParams)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }
      const parsedParams = parsed.data

      const {
        limit,
        max_id: encodedMaxId,
        min_id: encodedMinId,
        since_id: encodedSinceId
      } = parsedParams

      // Clients echo back the opaque ids this endpoint emits (urlToId-encoded
      // status URLs), so decode the cursors before querying — the database
      // stores raw status URLs and silently ignores an unknown cursor, which
      // would serve the same first page over and over. An undecodable cursor
      // is a deliberate 400, matching the timeline endpoints.
      const maxId = encodedMaxId ? safeIdToUrl(encodedMaxId) : undefined
      const minId = encodedMinId ? safeIdToUrl(encodedMinId) : undefined
      const sinceId = encodedSinceId ? safeIdToUrl(encodedSinceId) : undefined
      if (maxId === null || minId === null || sinceId === null) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const follow =
        currentActor && currentActor.id !== id
          ? await database.getAcceptedOrRequestedFollow({
              actorId: currentActor.id,
              targetActorId: id
            })
          : null
      const isFollower =
        currentActor && currentActor.id !== id
          ? follow?.status === FollowStatus.enum.Accepted
          : false
      const isOwner = currentActor?.id === id
      const followerStateByActorId = currentActor
        ? new Map<string, boolean>()
        : undefined
      if (currentActor && !isOwner) {
        followerStateByActorId?.set(id, isFollower)
      }

      const readableStatuses: Status[] = []
      let nextMaxId = maxId
      let scannedBatches = 0

      while (
        readableStatuses.length < limit &&
        scannedBatches < MAX_STATUS_SCAN_BATCHES
      ) {
        scannedBatches += 1

        const statuses = await database.getActorStatuses({
          actorId: id,
          maxStatusId: nextMaxId,
          minStatusId: minId || sinceId,
          limit,
          publicOnly: currentActor === null,
          visibleToActorId: currentActor && !isOwner ? currentActor.id : null,
          includeFollowersOnly: isFollower,
          followersAudience: actor.followersUrl,
          onlyMedia: parsedParams.only_media === true,
          excludeReplies: parsedParams.exclude_replies === true,
          excludeReblogs: parsedParams.exclude_reblogs === true,
          tagged: parsedParams.tagged,
          pinned: parsedParams.pinned === true
        })

        if (statuses.length === 0) break

        const originalAuthorIds: string[] = []
        if (currentActor) {
          const seen = new Set<string>()
          for (const status of statuses) {
            if (status.type !== StatusType.enum.Announce) continue

            const { actorId } = status.originalStatus
            if (
              actorId !== currentActor.id &&
              !followerStateByActorId?.has(actorId) &&
              !seen.has(actorId)
            ) {
              seen.add(actorId)
              originalAuthorIds.push(actorId)
            }
          }
        }

        await Promise.all(
          originalAuthorIds.map(async (targetActorId) => {
            if (!currentActor) return
            const originalFollow = await database.getAcceptedOrRequestedFollow({
              actorId: currentActor.id,
              targetActorId
            })
            const originalIsFollower =
              originalFollow?.status === FollowStatus.enum.Accepted
            followerStateByActorId?.set(targetActorId, originalIsFollower)
          })
        )

        const readableBatch = (
          await Promise.all(
            statuses.map(async (status) =>
              (await canActorReadStatus({
                database,
                status,
                currentActor,
                isFollower,
                followerStateByActorId
              }))
                ? status
                : null
            )
          )
        ).filter((status): status is Status => status !== null)

        readableStatuses.push(...readableBatch)

        if (statuses.length < limit) break
        nextMaxId = statuses[statuses.length - 1].id
      }

      // A remote actor's posts only exist locally once they federate here, so
      // the local store usually can't fill a profile's first page. Fetch the
      // actor's recent public posts live from their outbox instead — display
      // only, nothing is persisted. Gated on an authenticated viewer (like
      // remote lookups) and a first-page request; failures fall back to the
      // locally-stored statuses.
      let liveRemoteStatuses: Status[] = []
      const isFirstPage = !maxId && !minId && !sinceId
      if (
        currentActor &&
        isFirstPage &&
        !actor.privateKey &&
        readableStatuses.length < limit &&
        parsedParams.pinned !== true &&
        !parsedParams.tagged
      ) {
        liveRemoteStatuses = await getRemoteActorStatuses({
          database,
          actorId: id,
          limit,
          excludeReplies: parsedParams.exclude_replies === true,
          excludeReblogs: parsedParams.exclude_reblogs === true,
          onlyMedia: parsedParams.only_media === true
        })
      }
      const servedLiveStatuses = liveRemoteStatuses.length > 0

      const visibleStatuses = servedLiveStatuses
        ? liveRemoteStatuses
        : readableStatuses.slice(0, limit)
      const visibleStatusIds = visibleStatuses.map((status) => status.id)
      const pinnedStatusIds =
        currentActor?.id === id && parsedParams.pinned === true
          ? new Set(visibleStatusIds)
          : undefined

      const mastodonStatuses = await getMastodonStatuses(
        database,
        visibleStatuses,
        currentActor?.id,
        pinnedStatusIds ? { pinnedStatusIds } : undefined
      )

      const host = headerHost(req.headers)
      const pathBase = `/api/v1/accounts/${encodedAccountId}/statuses`

      const linkBaseParams = new URLSearchParams()
      linkBaseParams.set('limit', `${limit}`)
      for (const key of [
        'only_media',
        'exclude_replies',
        'exclude_reblogs',
        'pinned',
        'tagged'
      ]) {
        const value = url.searchParams.get(key)
        if (value !== null) linkBaseParams.set(key, value)
      }

      const buildLink = (
        cursorName: 'max_id' | 'min_id',
        cursorValue: string
      ) => {
        const linkParams = new URLSearchParams(linkBaseParams)
        linkParams.set(cursorName, cursorValue)
        return `<https://${host}${pathBase}?${linkParams.toString()}>; rel="${cursorName === 'max_id' ? 'next' : 'prev'}"`
      }

      // Live-fetched statuses carry remote ids the local store can't use as
      // cursors (getActorStatuses ignores unknown max_id/min_id, which would
      // make clients loop over the same page), so a live page is served
      // without pagination links.
      const nextLink =
        !servedLiveStatuses && mastodonStatuses.length > 0
          ? buildLink(
              'max_id',
              mastodonStatuses[mastodonStatuses.length - 1].id
            )
          : null

      const prevLink =
        !servedLiveStatuses && mastodonStatuses.length > 0
          ? buildLink('min_id', mastodonStatuses[0].id)
          : null

      const links = [nextLink, prevLink].filter(Boolean).join(', ')

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatuses,
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    },
    {
      errorResponse: corsErrorResponse(CORS_HEADERS),
      matchMode: 'any'
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
