import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorDomains',
  AuthenticatedGuard(async (req: NextRequest) => {
    const config = getConfig()
    const { federation } = await getResolvedServerSettings()
    const allowedDomains = federation.allowActorDomains.length
      ? federation.allowActorDomains
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
