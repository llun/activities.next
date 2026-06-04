import { NextRequest } from 'next/server'

import {
  NODE_INFO_20_CONTENT_TYPE,
  buildNodeInfo20
} from '@/lib/services/wellknown'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('nodeInfoV2', async (req: NextRequest) => {
  const nodeInfo = await buildNodeInfo20()
  if (!nodeInfo) {
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
    data: nodeInfo,
    additionalHeaders: [['Content-Type', NODE_INFO_20_CONTENT_TYPE]]
  })
})
