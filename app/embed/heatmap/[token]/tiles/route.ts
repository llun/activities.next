import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { MAX_TILES_PER_REQUEST } from '@/lib/services/fitness-files/heatmapTiles/constants'
import {
  isLadderZoom,
  parseTileIndexList,
  resolveShareRegionBounds,
  serveHeatmapTiles
} from '@/lib/services/fitness-files/heatmapTiles/serveTiles'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

/**
 * Cache the tiles at the edge, but only briefly, for the reason the sibling
 * image route gives: when the owner revokes a share the origin starts 404ing,
 * and the TTL bounds how long a CDN keeps serving what it already has. Five
 * minutes rather than the image's sixty seconds because a tile is immutable for
 * its version — the URL carries `v`, so a regenerate produces different URLs —
 * and a map pans across far more requests than a thumbnail does.
 */
const CACHE_CONTROL = 'public, max-age=300, s-maxage=300'

/** See the owner tiles route: `MAX_TILES_PER_REQUEST` keys plus separators. */
const MAX_TILES_PARAM_LENGTH = MAX_TILES_PER_REQUEST * 12

interface Params {
  token: string
}

const tilesResponse = (body: unknown, etag: string) =>
  Response.json(body, {
    headers: new Headers([
      ['Cache-Control', CACHE_CONTROL],
      ['ETag', etag],
      // Matches the sibling image route: the share token is the capability and
      // the payload carries nothing the token does not already grant, so an
      // embedding page may read it directly. No credentials are involved —
      // this route never reads a session.
      ['Access-Control-Allow-Origin', '*']
    ])
  })

export const GET = traceApiRoute(
  'getFitnessRouteHeatmapEmbedTiles',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const { token } = await context.params

    const database = getDatabase()
    if (!database) return apiErrorResponse(500)

    const heatmap = await database.getFitnessRouteHeatmapByShareToken({
      shareToken: token
    })
    // Only serve a completed heatmap, for the reason the image route gives: a
    // re-queued share keeps its token while it regenerates, and this window is
    // not something the owner chose to publish.
    if (!heatmap || heatmap.status !== 'completed') return apiErrorResponse(404)

    const url = new URL(req.url)
    const zoom = Number(url.searchParams.get('z'))
    if (!Number.isInteger(zoom) || !isLadderZoom(zoom)) {
      return apiErrorResponse(400)
    }

    const rawTiles = url.searchParams.get('tiles') ?? ''
    if (rawTiles.length === 0 || rawTiles.length > MAX_TILES_PARAM_LENGTH) {
      return apiErrorResponse(400)
    }
    const tiles = parseTileIndexList(rawTiles, zoom)
    if (!tiles) return apiErrorResponse(400)

    const pyramid = await database.getFitnessRouteHeatmapPyramid({
      actorId: heatmap.actorId
    })
    // Nothing to serve until the owner's pyramid has completed a build. The
    // client is told to fall back to the untiled geometry the page already
    // carries rather than handed an empty map.
    if (!pyramid || pyramid.status !== 'completed' || pyramid.version < 1) {
      return apiErrorResponse(404)
    }

    const etag = `W/"${pyramid.version}"`
    // Same URL and same version means the same bytes: a completed build's tiles
    // are immutable, and every input that could change them — the token's row,
    // the zoom, the tile list — is part of the URL or was checked above.
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: new Headers([
          ['Cache-Control', CACHE_CONTROL],
          ['ETag', etag],
          ['Access-Control-Allow-Origin', '*']
        ])
      })
    }

    // THE security boundary of this route. The pyramid covers the actor's whole
    // history; the share covers one rectangle of it. Clipping to the SHARED
    // ROW's region — never to anything the caller sent — is what stops a rect
    // share from being used to read the world pyramid behind it. A world-scoped
    // share resolves to no bounds and is served whole, which is what it is; an
    // unresolvable one is refused rather than served unclipped.
    const regionBounds = resolveShareRegionBounds(heatmap.region)
    if (!regionBounds) return apiErrorResponse(404)

    const served = await serveHeatmapTiles({
      database,
      actorId: heatmap.actorId,
      pyramid,
      z: zoom,
      tiles,
      regionBounds,
      stripPrivacy: true
    })

    return tilesResponse(served, etag)
  }
)
