import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorDomains',
  AuthenticatedGuard(async (req: NextRequest) => {
    const config = getConfig()
    const allowedDomains = config.allowActorDomains?.length
      ? config.allowActorDomains
      : [config.host]

    return apiResponse({
      req,
      allowedMethods: ['GET'],
      data: {
        domains: allowedDomains,
        host: config.host
      }
    })
  })
)
