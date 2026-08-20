import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import {
  deserializeRegions,
  getRegionBounds,
  normalizeRegionParam
} from '@/lib/fitness/regions'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  parseTileBatchQuery,
  serveHeatmapTiles
} from '@/lib/services/fitness-files/heatmapTiles/serveTiles'
import { AppRouterParams } from '@/lib/services/guards/types'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
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

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

/**
 * Only the region is validated here. The zoom, the tile list and `v` go through
 * `parseTileBatchQuery`, which the public tiles route shares — see its docblock
 * for why one parser rather than two.
 *
 * It is read with `searchParams.get`, not through `Object.fromEntries`, so a
 * repeated parameter resolves the same way everything else on this route does.
 * Region is the one SCOPE-BEARING parameter here, which is exactly the case the
 * shared parser exists to keep the two routes from disagreeing about.
 */
const FitnessRouteHeatmapTilesRegion = z.string().max(1024).nullable()

export const GET = traceApiRoute(
  'getAccountFitnessRouteHeatmapTiles',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const session = await getServerAuthSession()
    if (!session?.user?.email) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
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
    if (!encodedAccountId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
    const id = await resolveActorIdParam(database, encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const url = new URL(req.url)
    const parsed = FitnessRouteHeatmapTilesRegion.safeParse(
      url.searchParams.get('region')
    )
    const query = parseTileBatchQuery(url.searchParams)
    if (!parsed.success || !query) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const pyramid = await database.getFitnessRouteHeatmapPyramid({
      actorId: id
    })

    // The owner may see every tile, so clipping here is not a privacy boundary
    // — it is what makes a region-scoped view show the same extent the stored
    // heatmap for that region does, rather than the whole world behind it.
    //
    // There is deliberately no `isPyramidVariantHeatmap` gate to match the
    // public route's: this request names no heatmap row, only a region, and the
    // pyramid IS the all-activities/all-time dataset. A filtered row advertises
    // no `tileSource`, so nothing points a client here for one.
    const served = await serveHeatmapTiles({
      database,
      actorId: id,
      pyramid,
      z: query.z,
      tiles: query.tiles,
      regionBounds: getRegionBounds(
        deserializeRegions(normalizeRegionParam(parsed.data))
      ),
      stripPrivacy: false
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: served
    })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
