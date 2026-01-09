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

import { getJobMessage } from './getJobMessage'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = ActivityPubVerifySenderGuard(async (request) => {
  const body = await request.json()
  const activity = body as StatusActivity
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
