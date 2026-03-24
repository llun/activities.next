import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { NODE_SOFTWARE } from '@/lib/utils/version'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('nodeinfoV2', async (req: NextRequest) => {
  const config = getConfig()
  const database = getDatabase()
  if (!database) {
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { error: 'Internal Server Error' },
      responseStatusCode: 500
    })
  }
  const stats = await database.getNodeInfoStats()
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
          total: stats.totalUsers,
          activeMonth: stats.activeMonth,
          activeHalfyear: stats.activeHalfyear
        },
        localPosts: stats.localPosts
      },
      openRegistrations: false,
      metadata: {
        nodeName: config.serviceName,
        nodeDescription: ''
      }
    }
  })
})
