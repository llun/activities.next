import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { toPublicDomainBlock } from '@/lib/services/federation/domainRules'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { HTTP_STATUS, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.GET]

export const GET = traceApiRoute('getInstanceDomainBlocks', async (req) => {
  const database = getDatabase()
  if (!database) {
    return apiResponse({
      req: req as NextRequest,
      allowedMethods: CORS_HEADERS,
      data: { error: 'Database unavailable' },
      responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
    })
  }

  const blocks = await database.getDomainBlocks({ limit: 10_000 })

  return apiResponse({
    req: req as NextRequest,
    allowedMethods: CORS_HEADERS,
    data: blocks.map(toPublicDomainBlock)
  })
})
