import { z } from 'zod'

import { isCollectionPageUrl } from '@/lib/activities/getActorCollections'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import type { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { Scope } from '@/lib/types/database/operations'
import type { Actor } from '@/lib/types/domain/actor'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const StatusQueryParams = z.object({
  page_url: z.string().url().optional()
})

const overlayViewerState = <T extends StatusNote | StatusPoll>(
  live: T,
  stored: Status
): T => {
  if (
    stored.type !== StatusType.enum.Note &&
    stored.type !== StatusType.enum.Poll
  ) {
    return live
  }

  const isActorLiked = stored.isActorLiked
  const totalLikes =
    isActorLiked && (live.totalLikes ?? 0) === 0
      ? Math.max(live.totalLikes ?? 0, stored.totalLikes ?? 0)
      : live.totalLikes

  return {
    ...live,
    isActorLiked,
    isActorBookmarked: stored.isActorBookmarked,
    actorAnnounceStatusId: stored.actorAnnounceStatusId,
    totalLikes,
    ...(stored.reactions && stored.reactions.length > 0
      ? { reactions: stored.reactions }
      : {})
  }
}

const overlayStatusesWithViewerState = async (
  database: Database,
  currentActor: Actor | null,
  statuses: Status[]
): Promise<Status[]> => {
  if (!currentActor || statuses.length === 0) return statuses

  const targetIds = statuses
    .map((status) =>
      status.type === StatusType.enum.Announce
        ? status.originalStatus?.id
        : status.id
    )
    .filter((id): id is string => Boolean(id))

  if (targetIds.length === 0) return statuses

  const storedStatuses = await database.getStatusesByIds({
    statusIds: targetIds,
    currentActorId: currentActor.id,
    withReplies: false
  })

  const storedMap = new Map<string, Status>()
  for (const stored of storedStatuses) {
    storedMap.set(stored.id, stored)
  }

  return statuses.map((status) => {
    if (status.type === StatusType.enum.Announce) {
      const originalId = status.originalStatus?.id
      if (!originalId) return status
      const stored = storedMap.get(originalId)
      if (
        !stored ||
        (status.originalStatus.type !== StatusType.enum.Note &&
          status.originalStatus.type !== StatusType.enum.Poll)
      ) {
        return status
      }
      return {
        ...status,
        originalStatus: overlayViewerState(status.originalStatus, stored)
      }
    }

    if (
      status.type === StatusType.enum.Note ||
      status.type === StatusType.enum.Poll
    ) {
      const stored = storedMap.get(status.id)
      if (!stored) return status
      return overlayViewerState(status, stored)
    }

    return status
  })
}

export const GET = traceApiRoute(
  'getRemoteAccountStatuses',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { currentActor, database, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

    const url = new URL(req.url)
    const parsed = StatusQueryParams.safeParse(
      Object.fromEntries(url.searchParams.entries())
    )
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const actorId = await resolveActorIdParam(database, encodedAccountId)

    // Server-to-server federation fetches must be signed by the dedicated
    // headless instance actor, never the viewer's user actor. Authorized-fetch
    // ("secure mode") remotes reject unsigned requests with 401, and on
    // multi-domain setups the viewer's key may not be publicly resolvable. The
    // instance actor always exists, always has a private key, and is served at
    // a publicly resolvable URL so the remote can fetch its key and verify the
    // signature. Resolution is best-effort: a missing/failed signer degrades to
    // an unsigned fetch (a clean 404) rather than turning into a 500. Domain
    // policy applies to every live-outbox surface: blocked domains are not
    // fetchable here either.
    const [canFederate, signingActor] = await Promise.all([
      canFederateWithDomain(database, actorId),
      getFederationSigningActorSafe(database, 'for remote account statuses')
    ])
    if (!canFederate) return apiCorsError(req, CORS_HEADERS, 404)

    const person = await getActorPerson({ actorId, signingActor })
    if (!person) return apiCorsError(req, CORS_HEADERS, 404)

    if (
      parsed.data.page_url &&
      (!person.outbox ||
        !isCollectionPageUrl(parsed.data.page_url, person.outbox))
    ) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const result = await getActorPosts({
      database,
      person,
      signingActor,
      pageUrl: parsed.data.page_url
    })

    const statuses = await overlayStatusesWithViewerState(
      database,
      currentActor,
      result.statuses
    )

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        statuses: statuses.map((status) => cleanJson(status)),
        statusesCount: result.statusesCount,
        nextPageUrl: result.nextPageUrl,
        prevPageUrl: result.prevPageUrl
      }
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
