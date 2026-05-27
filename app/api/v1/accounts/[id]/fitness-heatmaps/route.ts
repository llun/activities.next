import { NextRequest } from 'next/server'

// Deprecated legacy v1 shim. Prefer /fitness-route-heatmaps; keep this adapter
// until the next major API cleanup so older clients retain the flat summaries.
import {
  OPTIONS,
  GET as getRouteHeatmaps
} from '@/app/api/v1/accounts/[id]/fitness-route-heatmaps/route'
import { AppRouterParams } from '@/lib/services/guards/types'
import { FitnessRouteHeatmapSummary } from '@/lib/types/database/fitnessRouteHeatmap'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse } from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

interface Params {
  id: string
}

const toLegacyHeatmapSummary = (heatmap: FitnessRouteHeatmapSummary) => ({
  id: heatmap.id,
  activityType: heatmap.activityType,
  periodType: heatmap.periodType,
  periodKey: heatmap.periodKey,
  region: heatmap.region,
  status: heatmap.status,
  imagePath: null,
  activityCount: heatmap.activityCount,
  error: heatmap.error ?? null,
  createdAt: heatmap.createdAt,
  updatedAt: heatmap.updatedAt
})

export const GET = async (
  req: NextRequest,
  params: AppRouterParams<Params>
) => {
  const response = await getRouteHeatmaps(req, params)
  if (response.status !== 200) {
    return response
  }

  let payload: { heatmaps?: FitnessRouteHeatmapSummary[] }
  try {
    payload = await response.json()
  } catch {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_500,
      responseStatusCode: 500
    })
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      heatmaps: (payload.heatmaps ?? []).map(toLegacyHeatmapSummary)
    }
  })
}

export { OPTIONS }
