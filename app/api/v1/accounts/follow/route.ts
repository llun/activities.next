import { NextRequest } from 'next/server'

/**

 * @deprecated Use POST /api/v1/accounts/:id/follow and /unfollow instead
 * This custom endpoint is maintained for backward compatibility.
 */
import { follow, unfollow } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { FollowStatus } from '@/lib/types/domain/follow'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  DEFAULT_202,
  ERROR_404,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { FollowRequest } from './types'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const getJsonBody = async (req: NextRequest) => {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}

const invalidJsonBodyResponse = (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: { error: 'Invalid JSON body' },
    responseStatusCode: HTTP_STATUS.BAD_REQUEST
  })

const invalidFollowRequestResponse = (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: { error: 'Invalid input' },
    responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
  })

type ParseFollowRequestBodyResult =
  { ok: true; data: FollowRequest } | { ok: false; response: Response }

const parseFollowRequestBody = async (
  req: NextRequest
): Promise<ParseFollowRequestBodyResult> => {
  const body = await getJsonBody(req)
  if (body === undefined) {
    return { ok: false, response: invalidJsonBodyResponse(req) }
  }

  const parsed = FollowRequest.safeParse(body)
  if (!parsed.success) {
    return { ok: false, response: invalidFollowRequestResponse(req) }
  }

  return { ok: true, data: parsed.data }
}

export const GET = traceApiRoute(
  'getFollowFromUrl',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const params = new URL(req.url).searchParams
    const targetActorId = params.get('targetActorId')
    if (!targetActorId)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    const follow = await database.getAcceptedOrRequestedFollow({
      actorId: currentActor.id,
      targetActorId: targetActorId as string
    })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: { follow } })
  })
)

export const POST = traceApiRoute(
  'followAccountFromUrl',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const parsed = await parseFollowRequestBody(req)
    if (!parsed.ok) return parsed.response

    const { target } = parsed.data
    if (!(await canFederateWithDomain(database, target))) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { status: 'Forbidden' },
        responseStatusCode: HTTP_STATUS.FORBIDDEN
      })
    }

    const signingActor = await getFederationSigningActor(database)
    const person = await getActorPerson({
      actorId: target,
      signingActor
    })
    if (!person)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    const followItem = await database.createFollow({
      actorId: currentActor.id,
      targetActorId: target,
      status: FollowStatus.enum.Requested,
      inbox: `${currentActor.id}/inbox`,
      sharedInbox: `https://${currentActor.domain}/inbox`
    })
    await follow(followItem.id, currentActor, target, signingActor)
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: DEFAULT_202,
      responseStatusCode: HTTP_STATUS.ACCEPTED
    })
  })
)

export const DELETE = traceApiRoute(
  'unfollowAccountFromUrl',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const parsed = await parseFollowRequestBody(req)
    if (!parsed.ok) return parsed.response

    const { target } = parsed.data
    const follow = await database.getAcceptedOrRequestedFollow({
      actorId: currentActor.id,
      targetActorId: target
    })
    if (!follow)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    const canFederate = await canFederateWithDomain(database, target)
    const signingActor = canFederate
      ? await getFederationSigningActor(database)
      : undefined
    await Promise.all([
      canFederate ? unfollow(currentActor, follow, signingActor) : undefined,
      database.updateFollowStatus({
        followId: follow.id,
        status: FollowStatus.enum.Undo
      })
    ])
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: DEFAULT_202,
      responseStatusCode: HTTP_STATUS.ACCEPTED
    })
  })
)
