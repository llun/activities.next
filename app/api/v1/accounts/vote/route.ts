import { sendPollVotes } from '@/lib/activities'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { VotePollRequest } from './types'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'voteToAccount',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const body = await req.json()
    const { statusId, choices } = VotePollRequest.parse(body)

    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status || status.type !== StatusType.enum.Poll) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Not Found' },
        responseStatusCode: 404
      })
    }

    if (Date.now() > status.endAt) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Unprocessable entity' },
        responseStatusCode: 422
      })
    }

    const hasVoted = await database.hasActorVoted({
      statusId,
      actorId: currentActor.id
    })

    if (status.pollType === 'oneOf' && hasVoted) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Unprocessable entity' },
        responseStatusCode: 422
      })
    }

    if (status.pollType === 'oneOf' && choices.length > 1) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Unprocessable entity' },
        responseStatusCode: 422
      })
    }

    await Promise.all(
      choices.map((choiceIndex) =>
        database.createPollAnswer({
          statusId,
          actorId: currentActor.id,
          choice: choiceIndex
        })
      )
    )

    await Promise.all(
      choices.map((choiceIndex) =>
        database.incrementPollChoiceVotes({ statusId, choiceIndex })
      )
    )

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
