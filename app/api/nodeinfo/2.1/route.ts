import { NextRequest } from 'next/server'

import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { headerHost } from '@/lib/services/guards/headerHost'
import {
  NODE_INFO_21_CONTENT_TYPE,
  buildNodeInfo21
} from '@/lib/services/wellknown'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('nodeInfoV21', async (req: NextRequest) => {
  // Refresh first: `headerHost` trusts the visited host from the snapshot.
  await ensureServedDomainsFresh()
  const nodeInfo = await buildNodeInfo21(headerHost(req.headers))
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
    additionalHeaders: [['Content-Type', NODE_INFO_21_CONTENT_TYPE]]
  })
})
