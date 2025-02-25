import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = async (req: NextRequest) => {
  const config = getConfig()
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      links: [
        {
          rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
          href: `https://${config.host}/.well-known/nodeinfo/2.0`
        }
      ]
    }
  })
}
