import { NextRequest } from 'next/server'

import { buildBaseURL } from '@/lib/config'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getNodeInfoLinks } from '@/lib/services/wellknown'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('getNodeInfo', async (req: NextRequest) => {
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: getNodeInfoLinks(buildBaseURL(headerHost(req.headers)))
  })
})
