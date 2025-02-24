import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { VERSION } from '@/lib/constants'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = async (req: NextRequest) => {
  const config = getConfig()
  return apiResponse(req, CORS_HEADERS, {
    version: '2.0',
    software: {
      name: 'mastodon',
      version: `activities.next-${VERSION}`
    },
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
  })
}
