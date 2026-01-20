import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'

const SetDefaultDomainRequest = z.object({
  domain: z.string().min(1)
})

export const POST = AuthenticatedGuard(async (req, context) => {
  const { currentActor, database } = context

  if (!currentActor.account) {
    return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
  }

  const body = await req.json()
  const parsed = SetDefaultDomainRequest.safeParse(body)

  if (!parsed.success) {
    return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
  }

  const { domain } = parsed.data
  const config = getConfig()

  if (!config.domains.includes(domain)) {
    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { error: 'Domain is not allowed' },
      responseStatusCode: HTTP_STATUS.BAD_REQUEST
    })
  }

  await database.setDefaultActorDomain({
    accountId: currentActor.account.id,
    domain
  })

  return apiResponse({
    req,
    allowedMethods: ['POST'],
    data: {
      defaultActorDomain: domain
    }
  })
})
