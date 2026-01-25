import { StatusActivity } from '@/lib/activities/actions/status'
import { ActivityPubVerifySenderGuard } from '@/lib/services/guards/ActivityPubVerifyGuard'
import { getQueue } from '@/lib/services/queue'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  DEFAULT_202,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { getJobMessage } from './getJobMessage'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const POST = traceApiRoute(
  'sharedInbox',
  ActivityPubVerifySenderGuard(async (request) => {
    const body = await request.json()
    if (
      !isRecord(body) ||
      typeof body.id !== 'string' ||
      typeof body.type !== 'string'
    ) {
      return apiErrorResponse(400)
    }
    const activity = body as unknown as StatusActivity
    const jobMessage = getJobMessage(activity)
    if (!jobMessage) {
      return apiErrorResponse(404)
    }

    await getQueue().publish(jobMessage)
    return apiResponse({
      req: request,
      allowedMethods: CORS_HEADERS,
      data: DEFAULT_202,
      responseStatusCode: 202
    })
  })
)
