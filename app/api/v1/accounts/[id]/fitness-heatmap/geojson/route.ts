import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { getHeatmapGeoJSON } from '@/lib/services/fitness-files/getHeatmapGeoJSON'
import {
  getFitnessFileBuffer,
} from '@/lib/services/fitness-files'
import {
  isParseableFitnessFileType,
  parseFitnessFile,
  FitnessCoordinate
} from '@/lib/services/fitness-files/parseFitnessFile'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { AppRouterParams } from '@/lib/services/guards/types'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_400,
  ERROR_401,
  ERROR_403,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'
import { deserializeRegions, getRegionBounds } from '@/lib/fitness/regions'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const FitnessHeatmapRoutesQueryParams = z.object({
  activity_type: z.string().optional(),
  period_type: z.enum(['all_time', 'yearly', 'monthly']),
  period_key: z.string(),
  region: z.string().optional()
})

const getPeriodRange = (
  periodType: string,
  periodKey: string
): { periodStart: Date; periodEnd: Date } => {
  switch (periodType) {
    case 'yearly': {
      const year = parseInt(periodKey, 10)
      return {
        periodStart: new Date(Date.UTC(year, 0, 1)),
        periodEnd: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
      }
    }
    case 'monthly': {
      const [year, month] = periodKey.split('-').map(Number)
      const periodStart = new Date(Date.UTC(year, month - 1, 1))
      const nextMonth = new Date(Date.UTC(year, month, 1))
      const periodEnd = new Date(nextMonth.getTime() - 1)
      return { periodStart, periodEnd }
    }
    default: {
      return {
        periodStart: new Date(Date.UTC(1970, 0, 1)),
        periodEnd: new Date(Date.UTC(2100, 11, 31, 23, 59, 59, 999))
      }
    }
  }
}

export const GET = traceApiRoute(
  'getAccountFitnessHeatmapGeoJSON',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const session = await getServerAuthSession()
    if (!session?.user?.email) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    const { id: encodedAccountId } = await params.params
    if (!encodedAccountId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
    const id = idToUrl(encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const parsed = FitnessHeatmapRoutesQueryParams.safeParse(queryParams)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const {
      activity_type: activityType,
      period_type: periodType,
      period_key: periodKey,
      region: rawRegion
    } = parsed.data

    const regionBounds = rawRegion
      ? getRegionBounds(deserializeRegions(rawRegion))
      : []

    const { periodStart, periodEnd } = getPeriodRange(periodType, periodKey)

    const PAGE_SIZE = 500
    const matchingFiles = await database.getFitnessFilesByActor({
      actorId: id,
      processingStatus: 'completed',
      isPrimary: true,
      ...(activityType ? { activityType } : {}),
      ...(periodType !== 'all_time' ? { startDate: periodStart, endDate: periodEnd } : {}),
      limit: PAGE_SIZE,
      offset: 0
    })

    const allRouteSegments: FitnessCoordinate[][] = []

    for (const file of matchingFiles) {
      try {
        if (!isParseableFitnessFileType(file.fileType)) continue

        const buffer = await getFitnessFileBuffer(database, file.id)
        const activityData = await parseFitnessFile({
          fileType: file.fileType,
          buffer
        })

        if (activityData.coordinates.length >= 2) {
          allRouteSegments.push(activityData.coordinates)
        }
      } catch {
        // Skip files that fail to parse
      }
    }

    const geojson = getHeatmapGeoJSON({
      routeSegments: allRouteSegments,
      regionBounds
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: geojson
    })
  }
)
