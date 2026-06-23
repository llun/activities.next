import { DEFAULT_ROUTE_HEATMAP_MAX_POINTS } from '@/lib/services/fitness-files/routeHeatmap'

export type FitnessRouteHeatmapConfig = {
  /**
   * Live-allocation ceiling (V8 `heapUsed + external`) that trips route
   * accumulation downsampling. The generation worker targets a ~1GB container,
   * so the default keeps live memory comfortably under that with headroom for
   * the Node runtime and per-file download/parse buffers (the off-heap part is
   * captured by `external`). Override via
   * `ACTIVITIES_FITNESS_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES`.
   */
  memoryBudgetBytes: number
  accumulationPointLimit: number
  filePointLimit: number
  /**
   * Ramer–Douglas–Peucker tolerance, in meters, applied to each route before it
   * is accumulated and to the final stored payload. Vertices closer than this to
   * the simplified line are dropped, so straight stretches collapse toward their
   * endpoints while bends keep the detail needed to trace the road. Smaller =
   * higher fidelity and larger payloads; the default sits inside a road lane so
   * the rendered line still follows the road when zoomed in. Override via
   * `ACTIVITIES_FITNESS_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS`.
   */
  simplifyToleranceMeters: number
}

// 512MB live-allocation trigger: half of the ~1GB machine budget, leaving room
// for the runtime and transient file buffers before memory pressure builds.
export const DEFAULT_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES = 512 * 1024 * 1024
export const DEFAULT_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT =
  DEFAULT_ROUTE_HEATMAP_MAX_POINTS * 2
export const DEFAULT_ROUTE_HEATMAP_FILE_POINT_LIMIT =
  DEFAULT_ROUTE_HEATMAP_MAX_POINTS
// 2m keeps the simplified line within a single road lane of the recorded track,
// so it still hugs the road at street zoom while dropping the redundant samples
// on straightaways. GPS noise is already a few meters, so a tighter tolerance
// would mostly preserve jitter at a steep payload cost.
export const DEFAULT_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS = 2

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const parsePositiveNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const getFitnessRouteHeatmapConfig = (): FitnessRouteHeatmapConfig => ({
  memoryBudgetBytes: parsePositiveInteger(
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES,
    DEFAULT_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES
  ),
  accumulationPointLimit: parsePositiveInteger(
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT,
    DEFAULT_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT
  ),
  filePointLimit: Math.max(
    2,
    parsePositiveInteger(
      process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_FILE_POINT_LIMIT,
      DEFAULT_ROUTE_HEATMAP_FILE_POINT_LIMIT
    )
  ),
  simplifyToleranceMeters: parsePositiveNumber(
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS,
    DEFAULT_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS
  )
})
