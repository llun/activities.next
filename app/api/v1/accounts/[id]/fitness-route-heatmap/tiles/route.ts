import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import {
  deserializeRegions,
  getRegionBounds,
  normalizeRegionParam
} from '@/lib/fitness/regions'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { MAX_TILES_PER_REQUEST } from '@/lib/services/fitness-files/heatmapTiles/constants'
import {
  isLadderZoom,
  parseTileIndexList,
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
 * `MAX_TILES_PER_REQUEST` keys of `"x:y"` plus separators. The widest key at
 * the deepest stored zoom is `65535:65535` (11 chars), so 12 per tile is the
 * bound; the parser rejects anything over the tile count regardless, and this
 * only stops an oversized string from being split at all.
 */
const MAX_TILES_PARAM_LENGTH = MAX_TILES_PER_REQUEST * 12

const FitnessRouteHeatmapTilesQueryParams = z.object({
  z: z.coerce.number().int(),
  tiles: z.string().min(1).max(MAX_TILES_PARAM_LENGTH),
  // See the sibling fitness-route-heatmap route: a looser raw cap that
  // normalizeRegionParam rounds + caps under the 255-char cache-key column.
  region: z.string().max(1024).optional(),
  /**
   * The pyramid version the client believes it is reading. Accepted so a client
   * can make its URLs change when the pyramid is rebuilt, and deliberately NOT
   * used to select tiles: a request naming a version that has since moved is
   * answered with the CURRENT tiles and the current version, never refused.
   * Refusing it would blank a map the moment a rebuild finished underneath a
   * client still holding the previous version.
   */
  v: z.coerce.number().int().nonnegative().optional()
})

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
    const parsed = FitnessRouteHeatmapTilesQueryParams.safeParse(
      Object.fromEntries(url.searchParams.entries())
    )
    if (!parsed.success || !isLadderZoom(parsed.data.z)) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const { z: zoom, tiles: rawTiles, region: rawRegion } = parsed.data
    const tiles = parseTileIndexList(rawTiles, zoom)
    if (!tiles) {
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
    const served = await serveHeatmapTiles({
      database,
      actorId: id,
      pyramid,
      z: zoom,
      tiles,
      regionBounds: getRegionBounds(
        deserializeRegions(normalizeRegionParam(rawRegion))
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
