import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import {
  parseTileBatchQuery,
  resolveShareRegionBounds,
  serveHeatmapTiles
} from '@/lib/services/fitness-files/heatmapTiles/serveTiles'
import { buildHeatmapTileSource } from '@/lib/services/fitness-files/heatmapTiles/tileSource'
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

interface Params {
  token: string
}

// Matches the sibling image route: the share token is the capability and the
// payload carries nothing the token does not already grant, so an embedding
// page may read it directly. No credentials are involved — this route never
// reads a session, so there is nothing a shared cache could cross-serve.
const publicHeaders = (etag: string) =>
  new Headers([
    ['Cache-Control', CACHE_CONTROL],
    ['ETag', etag],
    ['Access-Control-Allow-Origin', '*']
  ])

export const GET = traceApiRoute(
  'getFitnessRouteHeatmapEmbedTiles',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const { token } = await context.params

    const database = getDatabase()
    if (!database) return apiErrorResponse(500)

    // Summary-shaped: this route answers from the pyramid and needs the share
    // row only for its actor, status, scope and variant. The full row carries
    // the entire untiled heatmap, which a viewport would drag off disk and
    // through JSON.parse once per tile batch.
    const heatmap = await database.getFitnessRouteHeatmapSummaryByShareToken({
      shareToken: token
    })
    // Only serve a completed heatmap, for the reason the image route gives: a
    // re-queued share keeps its token while it regenerates, and this window is
    // not something the owner chose to publish.
    if (!heatmap || heatmap.status !== 'completed') return apiErrorResponse(404)

    const url = new URL(req.url)
    const query = parseTileBatchQuery(url.searchParams)
    if (!query) return apiErrorResponse(400)

    const pyramid = await database.getFitnessRouteHeatmapPyramid({
      actorId: heatmap.actorId
    })

    // The SAME predicate that decides whether a heatmap advertises a
    // `tileSource`, so the serving path and the advertising path cannot drift.
    // It is a privacy gate here, not a presentation one: the pyramid covers the
    // actor's whole history across every sport and every year, so answering a
    // share scoped to one of those from it publishes all of them. Null also
    // covers a pyramid that has not completed a build — the client falls back
    // to the untiled geometry the page already carries.
    const tileSource = buildHeatmapTileSource(heatmap, pyramid)
    if (!tileSource) return apiErrorResponse(404)

    // THE security boundary of this route, resolved before anything can answer.
    // The pyramid covers the actor's whole history; the share covers one
    // rectangle of it. Clipping to the SHARED ROW's region — never to anything
    // the caller sent — is what stops a rect share from being used to read the
    // world pyramid behind it. A world-scoped share resolves to no bounds and
    // is served whole, which is what it is; an unresolvable one is refused
    // rather than served unclipped. It runs ahead of the conditional-request
    // check so no response, 200 or 304, can be produced without it.
    const regionBounds = resolveShareRegionBounds(heatmap.region)
    if (!regionBounds) return apiErrorResponse(404)

    const etag = `W/"${tileSource.version}"`
    // Same URL and same version means the same bytes: a completed build's tiles
    // are immutable, and every input that could change them — the token's row,
    // the zoom, the tile list — is part of the URL or was checked above.
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: publicHeaders(etag) })
    }

    const served = await serveHeatmapTiles({
      database,
      actorId: heatmap.actorId,
      pyramid,
      z: query.z,
      tiles: query.tiles,
      regionBounds,
      stripPrivacy: true
    })

    return Response.json(served, { headers: publicHeaders(etag) })
  }
)
