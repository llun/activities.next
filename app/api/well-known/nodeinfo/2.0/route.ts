import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { NODE_SOFTWARE } from '@/lib/constants'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('nodeinfoV2', async (req: NextRequest) => {
  const config = getConfig()
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      version: '2.0',
      software: NODE_SOFTWARE,
      protocols: ['activitypub'],
      services: {
        outbound: [],
        inbound: []
      },
      usage: {
        users: {
          total: 1,
          activeMonth: 126,
          activeHalfyear: 288
        },
        localPosts: 150
      },
      openRegistrations: false,
      metadata: {
        nodeName: config.serviceName,
        nodeDescription: ''
      }
    }
  })
})
