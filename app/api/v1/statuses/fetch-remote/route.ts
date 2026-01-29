import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const FetchRemoteStatusRequest = z.object({
  statusUrl: z.string().url()
})

export const POST = traceApiRoute(
  'fetchRemoteStatus',
  async (request: NextRequest) => {
    try {
      const body = await request.json()
      const data = FetchRemoteStatusRequest.safeParse(body)

      if (!data.success) {
        return apiErrorResponse(400)
      }

      // Queue the job to fetch the remote status
      await getQueue().publish({
        id: crypto.randomUUID(),
        name: FETCH_REMOTE_STATUS_JOB_NAME,
        data: { statusUrl: data.data.statusUrl }
      })

      // Return 202 Accepted - job queued successfully
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { message: 'Fetch job queued' },
        responseStatusCode: 202
      })
    } catch (_error) {
      return apiErrorResponse(500)
    }
  }
)
