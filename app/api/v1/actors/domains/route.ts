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
    // Concrete domains only: a wildcard rule is not a domain to pick, though
    // POST /api/v1/actors still accepts a domain it covers — including the
    // host this request arrived on, which is listed when the rules allow it.
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
