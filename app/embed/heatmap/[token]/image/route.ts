import { NextRequest } from 'next/server'

import { getMapProviderConfig } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import {
  APPLE_SNAPSHOT_MAX_DIMENSION,
  APPLE_SNAPSHOT_MIN_DIMENSION,
  fetchAppleSnapshot
} from '@/lib/services/fitness-files/appleMapsSnapshot'
import { buildHeatmapSegmentsFromTiles } from '@/lib/services/fitness-files/heatmapTiles/segmentsFromTiles'
import {
  resolveSharedHeatmapRegionBounds,
  toPublicHeatmap
} from '@/lib/services/fitness-files/publicHeatmap'
import { rasterizeHeatmapSvg } from '@/lib/services/fitness-files/rasterizeHeatmapSvg'
import {
  buildHeatmapSvg,
  buildMapboxStaticUrl
} from '@/lib/services/fitness-files/staticHeatmapImage'
import type { FitnessRouteHeatmapSegment } from '@/lib/types/database/fitnessRouteHeatmap'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const DEFAULT_WIDTH = 600
const DEFAULT_HEIGHT = 400
const MIN_DIMENSION = 200
const MAX_DIMENSION = 1200
// Snap requested dimensions to this step so the query surface collapses onto a
// small, cacheable set of variants. Without it, `w`/`h` accept ~1000 values each
// (~1M combinations), letting anyone with a share token bust the edge cache and
// drive unbounded billable upstream Mapbox fetches. Snapping bounds it to a
// handful of buckets per axis.
const DIMENSION_STEP = 100
// Bound the upstream Mapbox fetch so a slow provider can't hold the request open
// (matches the AbortSignal.timeout pattern in lib/services/translation).
const MAPBOX_FETCH_TIMEOUT_MS = 5000
// Cache the thumbnail at the edge, but only briefly: when the owner revokes a
// share (or it is re-queued) the origin starts 404ing, and a short TTL bounds
// how long a CDN keeps serving an already-cached image after that. 60s trades a
// little cache efficiency for prompt revocation on a CDN-fronted deploy.
const CACHE_CONTROL = 'public, max-age=60, s-maxage=60'

interface Params {
  token: string
}

const snapDimension = (raw: string | null, fallback: number): number => {
  // `Number(null)`/`Number('')` are 0 (finite), so guard the absent/blank case
  // explicitly — otherwise an omitted ?w/?h would snap to MIN_DIMENSION instead
  // of the intended default.
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  const snapped = Math.round(value / DIMENSION_STEP) * DIMENSION_STEP
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, snapped))
}

// Opt-in raster output. The two basemap renderers already answer with raster
// bytes; only the keyless fallback serves SVG, so `format=png` means "never
// send SVG" and costs nothing on the other paths. It is opt-in because SVG is
// what this endpoint has always served keyless — it scales, and the embed
// snippet the share dialog hands out already points at this URL.
//
// Anything other than the exact string `png` falls back to the default, so the
// parameter collapses onto two cache variants rather than widening the surface
// DIMENSION_STEP exists to bound.
const wantsRaster = (raw: string | null): boolean =>
  raw?.trim().toLowerCase() === 'png'

// Apple Web Snapshots clamp each dimension into 50..640 (before `scale`). Scale
// both axes by a single factor so an oversized embed keeps its requested aspect
// ratio (a 1200x400 banner becomes 640x213, not a squashed 640x400), then clamp
// each axis into Apple's range. `scale=2` recovers the pixel density lost by the
// smaller logical size.
const APPLE_SNAPSHOT_SCALE = 2

const fitAppleDimensions = (
  width: number,
  height: number
): { width: number; height: number } => {
  const factor = Math.min(
    1,
    APPLE_SNAPSHOT_MAX_DIMENSION / width,
    APPLE_SNAPSHOT_MAX_DIMENSION / height
  )
  const clamp = (value: number) =>
    Math.min(
      APPLE_SNAPSHOT_MAX_DIMENSION,
      Math.max(APPLE_SNAPSHOT_MIN_DIMENSION, Math.round(value))
    )
  return { width: clamp(width * factor), height: clamp(height * factor) }
}

const imageResponse = (body: BodyInit, contentType: string) =>
  new Response(body, {
    headers: new Headers([
      ['Content-Type', contentType],
      ['Cache-Control', CACHE_CONTROL],
      ['Access-Control-Allow-Origin', '*']
    ])
  })

const svgResponse = (svg: string) =>
  imageResponse(svg, 'image/svg+xml; charset=utf-8')

export const GET = traceApiRoute(
  'getFitnessRouteHeatmapEmbedImage',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const { token } = await context.params

    const database = getDatabase()
    if (!database) return apiErrorResponse(500)

    const heatmap = await database.getFitnessRouteHeatmapByShareToken({
      shareToken: token
    })
    // Only serve a completed heatmap. A shared heatmap that is re-queued for
    // generation transitions back to pending/generating (segments nulled) while
    // keeping its token; 404 during that window rather than publish a partial
    // or empty embed the owner did not intend.
    if (!heatmap || heatmap.status !== 'completed') return apiErrorResponse(404)
    // See resolveSharedHeatmapRegionBounds: an unresolvable region means the
    // stored geometry was never clipped, so rendering it publishes the world.
    const regionBounds = resolveSharedHeatmapRegionBounds(heatmap)
    if (!regionBounds) return apiErrorResponse(404)

    const publicHeatmap = toPublicHeatmap(heatmap)
    const url = new URL(req.url)
    const width = snapDimension(url.searchParams.get('w'), DEFAULT_WIDTH)
    const height = snapDimension(url.searchParams.get('h'), DEFAULT_HEIGHT)
    const raster = wantsRaster(url.searchParams.get('format'))

    // Prefer the pyramid: the stored blob was simplified once to a single
    // global budget, so a thumbnail of a city drawn from it shows the same
    // coarse lines a whole-world view would. Tiles are simplified per rung, so
    // the image is drawn at the fidelity its own size warrants.
    //
    // Best-effort in both directions — an actor with no completed build, and a
    // read that fails, both keep the blob, which is an image the owner already
    // had. The whole row goes in, not just its actor id: the pyramid covers the
    // actor's whole history, so the builder has to refuse a share scoped to one
    // sport or one year and clip what is left to the share's own region.
    const tiled = publicHeatmap.bounds
      ? await buildHeatmapSegmentsFromTiles(database, {
          heatmap,
          bounds: publicHeatmap.bounds,
          width,
          height,
          regionBounds
        }).catch((error) => {
          logger.warn({
            message: 'Failed to build a route heatmap image from tiles',
            heatmapId: heatmap.id,
            actorId: heatmap.actorId,
            err: toLoggableError(error)
          })
          return null
        })
      : null
    // Tiles first, the stored blob second — and the renderer decides.
    //
    // Tile geometry is one run per way per tile where the blob is one polyline
    // per activity, so a street-level view is hundreds of overlays rather than
    // tens. The two basemap renderers cannot draw that: Apple refuses outright
    // past MAX_SNAPSHOT_OVERLAYS, and Mapbox silently drops whatever overruns
    // its URL budget, which for tile-ordered geometry means one contiguous
    // corner of the view that `/auto/` then frames the whole image on. Handing
    // the blob to a renderer that cannot take the tiles keeps exactly the image
    // such an instance serves today, instead of trading its basemap away for
    // fidelity it cannot show.
    const blobSegments = publicHeatmap.segments
    const candidates: FitnessRouteHeatmapSegment[][] = tiled?.length
      ? [tiled, blobSegments]
      : [blobSegments]

    const mapProvider = getMapProviderConfig()

    // Preferred for Apple: routes over an Apple basemap. The snapshot URL is
    // signed with the developer private key, so it is built, signed, and fetched
    // server-side and only the bytes are streamed back.
    if (mapProvider.type === 'apple') {
      const appleSize = fitAppleDimensions(width, height)
      for (const candidate of candidates) {
        // Trying the tiles first is free when they are over the ceiling:
        // `buildAppleSnapshotPath` refuses that input before it signs or
        // fetches anything, so the blob is reached without a request. When the
        // tiles DO fit, a failed attempt costs a real fetch and the blob is
        // then tried for real — which is the point. Apple answers 413 once the
        // URL grows too long and `SNAPSHOT_URL_BUDGET` is this module's guess
        // at where that is, so the candidate most likely to be refused upstream
        // is exactly the long one.
        const snapshot = await fetchAppleSnapshot(
          {
            segments: candidate,
            width: appleSize.width,
            height: appleSize.height,
            scale: APPLE_SNAPSHOT_SCALE
          },
          mapProvider
        )
        // Apple Web Snapshots answer with PNG bytes; pin the type rather than
        // trusting the upstream header on this anonymous, CORS-* response.
        if (snapshot) {
          return imageResponse(new Uint8Array(snapshot), 'image/png')
        }
      }
      // Otherwise fall through to the keyless SVG renderer below.
    }

    // Preferred: routes over a real Mapbox basemap. The static URL embeds the
    // token, so it is fetched server-side and the bytes are streamed back — the
    // token never reaches the browser. Any Mapbox token works here (including a
    // secret `sk.` one), unlike the browser-side descriptor.
    if (mapProvider.type === 'mapbox') {
      const mapboxUrl = candidates.reduce<string | null>(
        (found, candidate) =>
          found ??
          buildMapboxStaticUrl({
            segments: candidate,
            bounds: publicHeatmap.bounds ?? null,
            width,
            height,
            token: mapProvider.accessToken,
            // Only the blob may be truncated, which is what it has always done.
            requireAllOverlays: candidate !== blobSegments
          }),
        null
      )
      if (mapboxUrl) {
        try {
          const upstream = await fetch(mapboxUrl, {
            signal: AbortSignal.timeout(MAPBOX_FETCH_TIMEOUT_MS)
          })
          if (upstream.ok && upstream.body) {
            // Pin the type to an image regardless of what the upstream sets, so
            // this anonymous, CORS-* response can only ever be image bytes.
            const upstreamType = upstream.headers.get('content-type')
            const contentType = upstreamType?.startsWith('image/')
              ? upstreamType
              : 'image/png'
            return imageResponse(upstream.body, contentType)
          }
          // Release the un-consumed body before falling through, so undici does
          // not retain the socket until GC on a repeatedly-hit public endpoint.
          await upstream.body?.cancel().catch(() => {})
        } catch {
          // Fall through to the keyless SVG renderer below.
        }
      }
    }

    // Keyless fallback: route lines on a plain background. No overlay ceiling
    // and no URL to overrun, so it always takes the finest candidate.
    const svg = buildHeatmapSvg({
      segments: candidates[0],
      bounds: publicHeatmap.bounds ?? null,
      width,
      height
    })
    if (!raster) return svgResponse(svg)

    try {
      return imageResponse(await rasterizeHeatmapSvg(svg), 'image/png')
    } catch (error) {
      // Degrade to the SVG rather than 500. A caller that asked for a raster
      // wanted it for a crawler that will ignore the SVG, so the card loses its
      // image either way — but a browser pointed at the same URL still renders
      // it, and the response says which it got. Same trade the tile paths make:
      // a rendering shortfall must not cost the image entirely.
      logger.warn({
        message: 'Failed to rasterize a route heatmap image',
        heatmapId: heatmap.id,
        actorId: heatmap.actorId,
        err: toLoggableError(error)
      })
      return svgResponse(svg)
    }
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { shareToken: params?.token ? 'present' : 'missing' }
    }
  }
)
