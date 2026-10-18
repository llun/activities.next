import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import {
  getActorDomainChoices,
  getActorDomainRules
} from '@/lib/services/domains/actorDomains'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorDomains',
  AuthenticatedGuard(async (req: NextRequest, { database }) => {
    const config = getConfig()
    const { federation } = await getResolvedServerSettings(database)
    const host = headerHost(req.headers)
    // Concrete domains only: a wildcard rule is neither a domain to pick nor
    // an approval for POST /api/v1/actors. The host this request arrived on is
    // listed only when a concrete rule allows it.
    const allowedDomains = getActorDomainChoices(
      getActorDomainRules(config, federation.allowActorDomains),
      host
    )

    return apiResponse({
      req,
      allowedMethods: ['GET'],
      data: {
        domains: allowedDomains,
        host
      }
    })
  })
)
