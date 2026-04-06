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
