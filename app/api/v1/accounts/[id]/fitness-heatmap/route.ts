import { NextRequest } from 'next/server'

// Deprecated legacy v1 shim. Prefer /fitness-route-heatmap; keep this adapter
// until the next major API cleanup so older clients retain the flat payload.
import {
  OPTIONS,
  POST,
  GET as getRouteHeatmap
} from '@/app/api/v1/accounts/[id]/fitness-route-heatmap/route'
import { AppRouterParams } from '@/lib/services/guards/types'
import { FitnessRouteHeatmap } from '@/lib/types/database/fitnessRouteHeatmap'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, ERROR_500, apiResponse } from '@/lib/utils/response'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

interface Params {
  id: string
}

const toLegacyHeatmap = (heatmap: FitnessRouteHeatmap) => ({
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
  const response = await getRouteHeatmap(req, params)
  if (response.status !== 200) {
    return response
  }

  let payload: { heatmap?: FitnessRouteHeatmap | null }
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

  if (!payload.heatmap) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_404,
      responseStatusCode: 404
    })
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: toLegacyHeatmap(payload.heatmap)
  })
}

export { OPTIONS, POST }
