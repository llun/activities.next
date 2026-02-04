import crypto from 'crypto'
import { promisify } from 'util'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const generateKeyPair = promisify(crypto.generateKeyPair)

const CreateActorRequest = z.object({
  username: z.string().min(1).max(50),
  domain: z.string().min(1).optional()
})

export const GET = traceApiRoute(
  'getActors',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    if (!currentActor.account) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    const actors = await database.getActorsForAccount({
      accountId: currentActor.account.id
    })

    const actorsList = actors.map((actor) => ({
      id: actor.id,
      username: actor.username,
      domain: actor.domain,
      name: actor.name,
      iconUrl: actor.iconUrl,
      deletionStatus: actor.deletionStatus ?? null,
      deletionScheduledAt: actor.deletionScheduledAt ?? null
    }))

    return apiResponse({
      req,
      allowedMethods: ['GET', 'POST'],
      data: actorsList
    })
  })
)

export const POST = traceApiRoute(
  'createActor',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    if (!currentActor.account) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    const body = await req.json()
    const parsed = CreateActorRequest.safeParse(body)

    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const { username } = parsed.data
    const config = getConfig()
    const domain =
      parsed.data.domain ?? currentActor.domain ?? headerHost(req.headers)
    const allowedDomains = config.allowActorDomains?.length
      ? config.allowActorDomains
      : [config.host]

    if (!allowedDomains.includes(domain)) {
      return apiResponse({
        req,
        allowedMethods: ['GET', 'POST'],
        data: { error: 'Domain is not allowed' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const usernameExists = await database.isUsernameExists({ username, domain })
    if (usernameExists) {
      return apiResponse({
        req,
        allowedMethods: ['GET', 'POST'],
        data: { error: 'Username already exists' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const { publicKey, privateKey } = await generateKeyPair('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    })

    const actorId = await database.createActorForAccount({
      accountId: currentActor.account.id,
      username,
      domain,
      publicKey,
      privateKey
    })

    return apiResponse({
      req,
      allowedMethods: ['GET', 'POST'],
      data: { id: actorId, username, domain },
      responseStatusCode: HTTP_STATUS.OK
    })
  })
)
