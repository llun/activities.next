import { NextRequest } from 'next/server'

import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = async (req: NextRequest) => {
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      accounts: [],
      statuses: [],
      hashtags: []
    }
  })
}
