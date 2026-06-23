import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { toPublicHeatmap } from '@/lib/services/fitness-files/publicHeatmap'
import {
  buildHeatmapSvg,
  buildMapboxStaticUrl
} from '@/lib/services/fitness-files/staticHeatmapImage'
import { getPublicMapboxAccessToken } from '@/lib/utils/mapbox'
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
// Shared, anonymous, immutable-ish thumbnail — cache at the edge for a while.
const CACHE_CONTROL = 'public, max-age=300, s-maxage=300'

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

const svgResponse = (svg: string) =>
  new Response(svg, {
    headers: new Headers([
      ['Content-Type', 'image/svg+xml; charset=utf-8'],
      ['Cache-Control', CACHE_CONTROL],
      ['Access-Control-Allow-Origin', '*']
    ])
  })

export const GET = traceApiRoute(
  'getFitnessRouteHeatmapEmbedImage',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const { token } = await context.params

    const database = getDatabase()
    if (!database) return apiErrorResponse(500)

    const heatmap = await database.getFitnessRouteHeatmapByShareToken({
      shareToken: token
    })
    if (!heatmap) return apiErrorResponse(404)

    const publicHeatmap = toPublicHeatmap(heatmap)
    const url = new URL(req.url)
    const width = snapDimension(url.searchParams.get('w'), DEFAULT_WIDTH)
    const height = snapDimension(url.searchParams.get('h'), DEFAULT_HEIGHT)

    const mapboxAccessToken = getPublicMapboxAccessToken(
      getConfig().fitnessStorage?.mapboxAccessToken
    )

    // Preferred: routes over a real Mapbox basemap. The static URL embeds the
    // token, so it is fetched server-side and the bytes are streamed back — the
    // token never reaches the browser.
    if (mapboxAccessToken) {
      const mapboxUrl = buildMapboxStaticUrl({
        segments: publicHeatmap.segments,
        bounds: publicHeatmap.bounds ?? null,
        width,
        height,
        token: mapboxAccessToken
      })
      if (mapboxUrl) {
        try {
          const upstream = await fetch(mapboxUrl, {
            signal: AbortSignal.timeout(MAPBOX_FETCH_TIMEOUT_MS)
          })
          if (upstream.ok && upstream.body) {
            return new Response(upstream.body, {
              headers: new Headers([
                [
                  'Content-Type',
                  upstream.headers.get('content-type') ?? 'image/png'
                ],
                ['Cache-Control', CACHE_CONTROL],
                ['Access-Control-Allow-Origin', '*']
              ])
            })
          }
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
