import { StatusActivity } from '@/lib/activities/statusAction'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { ActivityPubVerifySenderGuard } from '@/lib/services/guards/ActivityPubVerifyGuard'
import { getQueue } from '@/lib/services/queue'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  DEFAULT_202,
  ERROR_400,
  ERROR_403,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { parse } from '@/lib/utils/signature'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { getJobMessage } from './getJobMessage'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeActorId = (actorId: string) => actorId.split('#')[0]

export const POST = traceApiRoute(
  'sharedInbox',
  ActivityPubVerifySenderGuard(async (request, { database }) => {
    const body = await request.json()
    if (
      !isRecord(body) ||
      typeof body.id !== 'string' ||
      typeof body.type !== 'string'
    ) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
    const activity = body as unknown as StatusActivity
    const signatureHeader = request.headers.get('signature')
    if (!signatureHeader) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
    const signatureParts = await parse(signatureHeader)
    if (
      !signatureParts.keyId ||
      normalizeActorId(signatureParts.keyId) !==
        normalizeActorId(activity.actor)
    ) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }
    if (!(await canFederateWithDomain(database, activity.actor))) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const jobMessage = getJobMessage(activity)
    if (!jobMessage) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    await getQueue().publish(jobMessage)
    return apiResponse({
      req: request,
      allowedMethods: CORS_HEADERS,
      data: DEFAULT_202,
      responseStatusCode: 202
    })
  }, CORS_HEADERS)
)
