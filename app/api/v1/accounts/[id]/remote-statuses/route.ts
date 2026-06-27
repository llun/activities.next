import { z } from 'zod'

import { isCollectionPageUrl } from '@/lib/activities/getActorCollections'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_400,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const StatusQueryParams = z.object({
  page_url: z.string().url().optional()
})

export const GET = traceApiRoute(
  'getRemoteAccountStatuses',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, params } = context
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

    const actorId = idToUrl(encodedAccountId)

    // Server-to-server federation fetches must be signed by the dedicated
    // headless instance actor, never the viewer's user actor. Authorized-fetch
    // ("secure mode") remotes reject unsigned requests with 401, and on
    // multi-domain setups the viewer's key may not be publicly resolvable. The
    // instance actor always exists, always has a private key, and is served at
    // a publicly resolvable URL so the remote can fetch its key and verify the
    // signature. Resolution is best-effort: a missing/failed signer degrades to
    // an unsigned fetch (a clean 404) rather than turning into a 500.
    const signingActor = await getFederationSigningActor(database).catch(
      (error) => {
        logger.warn({
          message:
            'Failed to resolve federation signing actor for remote account statuses; falling back to an unsigned request',
          error: error instanceof Error ? error.message : String(error)
        })
        return undefined
      }
    )

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

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        statuses: result.statuses.map((status) => cleanJson(status)),
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
