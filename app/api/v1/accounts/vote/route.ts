import { sendPollVotes } from '@/lib/activities'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { VotePollRequest } from './types'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'voteToAccount',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    let body: unknown
    try {
      // This UI-only endpoint is JSON-only; Mastodon clients use
      // /api/v1/polls/:id/votes for form-encoded compatibility.
      body = await req.json()
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const parsed = VotePollRequest.safeParse(body)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const { statusId } = parsed.data
    const choices = [...new Set(parsed.data.choices)]

    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status || status.type !== StatusType.enum.Poll) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    if (Date.now() > status.endAt) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const hasValidChoices = choices.every(
      (choice) => choice < status.choices.length
    )
    if (
      !hasValidChoices ||
      (status.pollType === 'oneOf' && choices.length > 1)
    ) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const votesRecorded = await database.recordPollVotes({
      statusId,
      actorId: currentActor.id,
      choices
    })
    if (!votesRecorded) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    await sendPollVotes({ currentActor, status, choices })

    const updatedStatus = await database.getStatus({
      statusId,
      withReplies: false
    })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { status: updatedStatus }
    })
  })
)
