import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import {
  getActorDomainChoices,
  getActorDomainRules,
  getAddableActorDomains
} from '@/lib/services/domains/actorDomains'
import { filterActorDomainsForAccount } from '@/lib/services/domains/signUpDomain'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorDomains',
  AuthenticatedGuard(async (req: NextRequest, { currentActor, database }) => {
    const config = getConfig()
    const [{ federation }, addableDomains] = await Promise.all([
      getResolvedServerSettings(database),
      getAddableActorDomains(database)
    ])
    const host = headerHost(req.headers)
    // Concrete domains only: a wildcard rule is neither a domain to pick nor
    // an approval for POST /api/v1/actors. The host this request arrived on is
    // listed only when a concrete rule allows it. POST also refuses the env
    // domains this account was not admitted to, so they are not offered.
    const choices = getActorDomainChoices(
      getActorDomainRules(config, federation.allowActorDomains, addableDomains),
      host
    )
    const allowedDomains = currentActor.account
      ? await filterActorDomainsForAccount(
          database,
          currentActor.account.id,
          choices
        )
      : []

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
