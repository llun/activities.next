import { NextRequest } from 'next/server'

import { NODE_SOFTWARE } from '@/lib/constants'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('getNodeInfo', async (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      version: '2.0',
      software: NODE_SOFTWARE,
      protocols: ['activitypub'],
      usage: {
        users: {
          total: 1,
          activeMonth: 1,
          activeHalfyear: 1
        },
        localPosts: 1
      },
      openRegistrations: false
    }
  })
)
