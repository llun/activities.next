import { NextRequest } from 'next/server'

import { getMapProviderConfig } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import {
  APPLE_SNAPSHOT_MAX_DIMENSION,
  APPLE_SNAPSHOT_MIN_DIMENSION,
  fetchAppleSnapshot
} from '@/lib/services/fitness-files/appleMapsSnapshot'
import { toPublicHeatmap } from '@/lib/services/fitness-files/publicHeatmap'
import {
  buildHeatmapSvg,
  buildMapboxStaticUrl
} from '@/lib/services/fitness-files/staticHeatmapImage'
import { apiErrorResponse } from '@/lib/utils/response'
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

    const publicHeatmap = toPublicHeatmap(heatmap)
    const url = new URL(req.url)
    const width = snapDimension(url.searchParams.get('w'), DEFAULT_WIDTH)
    const height = snapDimension(url.searchParams.get('h'), DEFAULT_HEIGHT)

    const mapProvider = getMapProviderConfig()

    // Preferred for Apple: routes over an Apple basemap. The snapshot URL is
    // signed with the developer private key, so it is built, signed, and fetched
    // server-side and only the bytes are streamed back.
    if (mapProvider.type === 'apple') {
      const appleSize = fitAppleDimensions(width, height)
      const snapshot = await fetchAppleSnapshot(
        {
          segments: publicHeatmap.segments,
          width: appleSize.width,
          height: appleSize.height,
          scale: APPLE_SNAPSHOT_SCALE
        },
        mapProvider
      )
      // Apple Web Snapshots answer with PNG bytes; pin the type rather than
      // trusting the upstream header on this anonymous, CORS-* response.
      if (snapshot) return imageResponse(new Uint8Array(snapshot), 'image/png')
      // Otherwise fall through to the keyless SVG renderer below.
    }

    // Preferred: routes over a real Mapbox basemap. The static URL embeds the
    // token, so it is fetched server-side and the bytes are streamed back — the
    // token never reaches the browser. Any Mapbox token works here (including a
    // secret `sk.` one), unlike the browser-side descriptor.
    if (mapProvider.type === 'mapbox') {
      const mapboxUrl = buildMapboxStaticUrl({
        segments: publicHeatmap.segments,
        bounds: publicHeatmap.bounds ?? null,
        width,
        height,
        token: mapProvider.accessToken
      })
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

    // Keyless fallback: route lines on a plain background.
    return svgResponse(
      buildHeatmapSvg({
        segments: publicHeatmap.segments,
        bounds: publicHeatmap.bounds ?? null,
        width,
        height
      })
    )
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { shareToken: params?.token ? 'present' : 'missing' }
    }
  }
)
