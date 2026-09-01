import { SpanStatusCode, trace } from '@opentelemetry/api'
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { headerHost } from '@/lib/services/guards/headerHost'
import {
  RemoteFollowField,
  getRemoteFollowCollectionPage
} from '@/lib/services/mastodon/remoteFollowCollection'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { Actor } from '@/lib/types/domain/actor'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import { ERROR_400, apiCorsError, apiResponse } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// Shared handler for GET /api/v1/accounts/:id/following and /followers.
// https://docs.joinmastodon.org/methods/accounts/#following
// https://docs.joinmastodon.org/methods/accounts/#followers
//
// Public with optional auth. Paginated with Mastodon id cursors + Link
// headers, mirroring the accounts/:id/statuses route.
//
// A LOCAL actor's list is the `follows` table, and the cursor is the follow-row
// id (the column getFollowing/getFollowers paginate on), not the account id.
//
// A REMOTE actor's list is read live from the collection its own server
// publishes — see `lib/services/mastodon/remoteFollowCollection.ts` — because
// the `follows` table only holds relationships this instance took part in,
// which for a remote actor is one local follower and nothing followed. On that
// path the cursor is the remote page URL: `max_id` carries the page's `next`,
// `min_id` its `prev`, so an unmodified Mastodon client paginates by sending
// the Link header's value straight back. When the remote is consulted, a
// cursor that parses as a URL is accepted only for a page of THAT actor's
// collection (the service applies the same `isCollectionPageUrl` check
// `remote-statuses` applies to its `page_url`) and is a 400 otherwise. On the
// local path — a local actor, or any of the fallbacks below — a URL cursor is
// ignored and the first local page served, because it names nothing among the
// follow-row ids that path paginates on; a cursor that is not a URL is such a
// row id.
//
// The remote read is only made for a signed-in viewer. The route is public,
// and each page can cost a signed fetch per unknown actor on it, so an
// anonymous caller gets the local rows exactly as before — the same line
// `search` and `accounts/lookup` draw around `resolve=true`. Every failure on
// the remote path (blocked domain, unreachable server, hidden collection)
// also falls back to the local rows, so today's behaviour is the floor.

export const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

const FollowCollectionQueryParams = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: clampedLimit(80, 40)
})

interface HandleParams {
  req: NextRequest
  database: Database
  currentActor: Actor | null
  encodedAccountId: string | undefined
  field: RemoteFollowField
}

const isUrlCursor = (cursor: string | undefined): cursor is string => {
  if (!cursor) return false
  try {
    const url = new URL(cursor)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const getLocalFollows = async (
  database: Database,
  field: RemoteFollowField,
  actorId: string,
  cursors: {
    limit: number
    maxId?: string
    minId?: string
    sinceId?: string
  }
) => {
  const follows =
    field === 'following'
      ? await database.getFollowing({ actorId, ...cursors })
      : await database.getFollowers({ targetActorId: actorId, ...cursors })
  return follows.map((follow) => ({
    id: follow.id,
    accountId: field === 'following' ? follow.targetActorId : follow.actorId
  }))
}

export const handleFollowCollectionRequest = async ({
  req,
  database,
  currentActor,
  encodedAccountId,
  field
}: HandleParams) => {
  if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

  const id = await resolveActorIdParam(database, encodedAccountId)
  const actor = await database.getActorFromId({ id })
  if (!actor) return apiCorsError(req, CORS_HEADERS, 404)

  const url = new URL(req.url)
  const parsed = FollowCollectionQueryParams.safeParse(
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
  const { limit, max_id: maxId, min_id: minId, since_id: sinceId } = parsed.data

  // Percent-encoded: the router hands the id over already decoded, and the
  // resolver accepts a raw http(s) URI as an id form, so the raw value would
  // emit a Link URL that does not route back here.
  const path = `/api/v1/accounts/${encodeURIComponent(encodedAccountId)}/${field}`
  const host = headerHost(req.headers)

  const isLocalActor = Boolean(actor.privateKey)
  const pageUrl = isUrlCursor(maxId)
    ? maxId
    : isUrlCursor(minId)
      ? minId
      : undefined

  if (!isLocalActor && currentActor) {
    const remote = await serveRemoteCollection({
      req,
      database,
      actorId: actor.id,
      field,
      pageUrl,
      limit,
      host,
      path
    })
    if (remote) return remote
  }

  // A remote page URL is meaningless against the follow-row ids the local path
  // paginates on: it is either a client re-sending a Link cursor to a
  // now-anonymous session, or one for a collection this instance could not
  // read this time. Serve the first local page rather than compare a URL
  // against row ids.
  const localCursors = {
    limit,
    maxId: isUrlCursor(maxId) ? undefined : maxId,
    minId: isUrlCursor(minId) ? undefined : minId,
    sinceId: isUrlCursor(sinceId) ? undefined : sinceId
  }
  const orderedFollows = await getLocalFollows(
    database,
    field,
    actor.id,
    localCursors
  )

  // Batch-hydrate the accounts in a single query, then re-order to match
  // orderedFollows (getMastodonActorsFromIds does not guarantee order).
  const accountsById = new Map(
    (
      await database.getMastodonActorsFromIds({
        ids: orderedFollows.map((follow) => follow.accountId)
      })
    ).map((account) => [account.url, account])
  )
  const accounts = orderedFollows
    .map((follow) => accountsById.get(follow.accountId))
    .filter((account): account is NonNullable<typeof account> =>
      Boolean(account)
    )

  const additionalHeaders = buildPaginationLinkHeader({
    host,
    path,
    limit,
    nextMaxId:
      orderedFollows.length > 0
        ? orderedFollows[orderedFollows.length - 1].id
        : null,
    prevMinId: orderedFollows.length > 0 ? orderedFollows[0].id : null
  })

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: accounts,
    additionalHeaders
  })
}

// The remote branch. Answers null wherever the local rows should be served
// instead; the one non-null failure is a URL cursor that does not belong to
// this actor's collection, which is a client error rather than a fallback.
const serveRemoteCollection = async ({
  req,
  database,
  actorId,
  field,
  pageUrl,
  limit,
  host,
  path
}: {
  req: NextRequest
  database: Database
  actorId: string
  field: RemoteFollowField
  pageUrl: string | undefined
  limit: number
  host: string | null | undefined
  path: string
}): Promise<Response | null> => {
  try {
    // Server-to-server fetches are signed by the headless instance actor,
    // never the viewer's actor; a missing signer degrades to an unsigned
    // fetch. Domain policy applies to every live-fetch surface, and is checked
    // here per request rather than inside the cached read so a newly blocked
    // domain is refused at once.
    const [canFederate, signingActor] = await Promise.all([
      canFederateWithDomain(database, actorId),
      getFederationSigningActorSafe(database, `for remote account ${field}`)
    ])
    if (!canFederate) return null

    const result = await getRemoteFollowCollectionPage({
      database,
      actorId,
      field,
      signingActor,
      pageUrl
    })
    if (result.status === 'unavailable') return null
    if (result.status === 'invalid-page') {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: result.page.accounts,
      additionalHeaders: buildPaginationLinkHeader({
        host,
        path,
        limit,
        nextMaxId: result.page.nextPageUrl,
        prevMinId: result.page.prevPageUrl
      })
    })
  } catch (error) {
    const span = trace.getActiveSpan()
    if (span) {
      span.recordException(
        error instanceof Error ? error : new Error(String(error))
      )
      span.setStatus({ code: SpanStatusCode.ERROR })
    }
    logger.warn({
      message: `Failed to read remote actor ${field} collection; serving local rows`,
      actorId,
      err: toLoggableError(error)
    })
    return null
  }
}
