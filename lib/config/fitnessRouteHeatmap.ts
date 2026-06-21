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
}

// 512MB live-allocation trigger: half of the ~1GB machine budget, leaving room
// for the runtime and transient file buffers before memory pressure builds.
export const DEFAULT_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES = 512 * 1024 * 1024
export const DEFAULT_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT =
  DEFAULT_ROUTE_HEATMAP_MAX_POINTS * 2
export const DEFAULT_ROUTE_HEATMAP_FILE_POINT_LIMIT =
  DEFAULT_ROUTE_HEATMAP_MAX_POINTS

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
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
  )
})
