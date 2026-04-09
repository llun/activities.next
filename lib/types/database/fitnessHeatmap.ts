export type FitnessHeatmapPeriodType = 'all_time' | 'yearly' | 'monthly'
export type FitnessHeatmapStatus =
  | 'pending'
  | 'generating'
  | 'completed'
  | 'failed'

export interface SQLFitnessHeatmap {
  id: string
  actorId: string
  activityType: string | null
  periodType: string
  periodKey: string
  /**
   * Serialized sorted comma-separated region IDs, e.g. "netherlands,singapore".
   * Empty string '' means world-wide (no region filter).
   * We use '' instead of NULL so the column participates in the UNIQUE constraint
   * correctly on both PostgreSQL (NULL != NULL) and SQLite.
   */
  region: string
  periodStart: Date | string | number | null
  periodEnd: Date | string | number | null
  imagePath: string | null
  status: string
  error: string | null
  activityCount: number
  createdAt: Date | string | number
  updatedAt: Date | string | number
  deletedAt: Date | string | number | null
}

export interface FitnessHeatmap {
  id: string
  actorId: string
  activityType?: string
  periodType: FitnessHeatmapPeriodType
  periodKey: string
  /**
   * Serialized sorted comma-separated region IDs, e.g. "netherlands,singapore".
   * Empty string '' or undefined means world-wide (no region filter).
   */
  region: string
  periodStart?: number
  periodEnd?: number
  imagePath?: string
  status: FitnessHeatmapStatus
  error?: string
  activityCount: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
}
