import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { deserializeRegions, serializeRegions } from '@/lib/fitness/regions'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { hasSameOriginProof } from '@/lib/services/guards/sameOriginProof'
import { AppRouterParams } from '@/lib/services/guards/types'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_401,
  ERROR_403,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const SetRegionNameBody = z.object({
  // Looser raw cap than the 255-char cache-key column: clients may send
  // high-precision coordinates that normalizeRegion rounds + caps under 255.
  region: z.string().max(1024),
  // The region label. Blank/whitespace/null clears the stored label. The DB
  // column is varchar(255); the UI input caps typing at 80.
  name: z
    .string()
    .max(255)
    .nullish()
    .transform((value) => value?.trim() || null)
})

// Canonicalises a raw region key the same way the heatmap routes do, so a saved
// label keys on the exact serialized form that a heatmap's `region` uses.
// `deserializeRegions`/`serializeRegions` are total (they drop unknown tokens
// rather than throwing), so malformed input — and the world-wide region — both
// normalize to the empty sentinel; return null for those since neither is a
// nameable region.
const normalizeRegion = (rawRegion: string): string | null =>
  serializeRegions(deserializeRegions(rawRegion)) || null

export const GET = traceApiRoute(
  'getAccountFitnessRouteHeatmapRegionNames',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const session = await getServerAuthSession()
    if (!session?.user?.email) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const { id: encodedAccountId } = await params.params
    const id = idToUrl(encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const names = await database.getFitnessRouteHeatmapRegionNames({
      actorId: id
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { names }
    })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)

export const PUT = traceApiRoute(
  'setAccountFitnessRouteHeatmapRegionName',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const session = await getServerAuthSession()
    if (!session?.user?.email) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    // Manually authenticated cookie-session mutation: apply the same CSRF
    // same-origin proof as AuthenticatedGuard.
    if (!hasSameOriginProof(req)) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const { id: encodedAccountId } = await params.params
    const id = idToUrl(encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const parsed = SetRegionNameBody.safeParse(body)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const region = normalizeRegion(parsed.data.region)
    // Reject the world-wide region (empty key, never named), malformed input
    // that normalized away to nothing, and — defensively — any key over the
    // 255-char column limit. `serializeRegions` already caps output to
    // MAX_HEATMAP_REGIONS (≤244 chars), so this guards future precision/cap
    // changes rather than a currently-reachable case.
    if (!region || region.length > 255) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    await database.setFitnessRouteHeatmapRegionName({
      actorId: id,
      region,
      name: parsed.data.name
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { region, name: parsed.data.name }
    })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
