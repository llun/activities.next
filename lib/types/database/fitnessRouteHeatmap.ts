export type FitnessRouteHeatmapPeriodType = 'all_time' | 'yearly' | 'monthly'
export type FitnessRouteHeatmapStatus =
  | 'pending'
  | 'generating'
  | 'completed'
  | 'failed'

export interface FitnessRouteHeatmapPoint {
  lat: number
  lng: number
}

export interface FitnessRouteHeatmapSegment {
  isHiddenByPrivacy?: boolean
  points: FitnessRouteHeatmapPoint[]
}

export interface FitnessRouteHeatmapBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export interface SQLFitnessRouteHeatmap {
  id: string
  actorId: string
  activityType: string | null
  activityTypeKey: string
  periodType: string
  periodKey: string
  /**
   * Serialized region scope: a sorted, semicolon-joined list of `rect:` tokens
   * (e.g. "rect:52.60,5.60,52.00,6.20"). Empty string '' means world-wide (no
   * region filter). See `serializeRegions` in `lib/fitness/regions`.
   */
  region: string
  periodStart: Date | string | number | null
  periodEnd: Date | string | number | null
  bounds: string | null
  segments: string | null
  status: string
  error: string | null
  activityCount: number
  pointCount: number
  /**
   * Total number of fitness files the generation run needs to scan, used as the
   * denominator for progress reporting. 0 means "not yet computed" (the job sets
   * it on the first pass of each run).
   */
  totalCount: number
  cursorOffset: number
  isPartial: boolean | number | string
  createdAt: Date | string | number
  updatedAt: Date | string | number
  deletedAt: Date | string | number | null
}

export interface FitnessRouteHeatmap {
  id: string
  actorId: string
  activityType?: string
  periodType: FitnessRouteHeatmapPeriodType
  periodKey: string
  region: string
  periodStart?: number
  periodEnd?: number
  bounds?: FitnessRouteHeatmapBounds
  segments: FitnessRouteHeatmapSegment[]
  status: FitnessRouteHeatmapStatus
  error?: string
  activityCount: number
  pointCount: number
  /**
   * Total number of fitness files the generation run needs to scan, used as the
   * progress denominator. 0 means "not yet computed".
   */
  totalCount: number
  cursorOffset: number
  isPartial: boolean
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export type FitnessRouteHeatmapSummary = Omit<
  FitnessRouteHeatmap,
  'bounds' | 'segments'
>
