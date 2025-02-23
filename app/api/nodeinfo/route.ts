import { NextRequest } from 'next/server'

import { VERSION } from '@/lib/constants'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = async (req: NextRequest) => {
  return apiResponse(req, CORS_HEADERS, {
    version: '2.0',
    software: {
      name: 'llun.activities',
      version: VERSION
    },
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
  })
}
