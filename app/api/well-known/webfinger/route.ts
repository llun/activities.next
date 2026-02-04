import { type NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getWebFingerResponse } from '@/lib/services/wellknown'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('webfinger', async (req: NextRequest) => {
  const url = new URL(req.url)
  const resource = url.searchParams.get('resource')
  if (!resource) return apiErrorResponse(404)

  const database = getDatabase()
  if (!database) return apiErrorResponse(500)

  const firstResource = Array.isArray(resource) ? resource[0] : resource
  const response = await getWebFingerResponse({
    database,
    resource: firstResource
  })

  if (!response) return apiErrorResponse(404)

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: response
  })
})
