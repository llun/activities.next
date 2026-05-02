import { z } from 'zod'

import { sendPollVotes } from '@/lib/activities'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { Scope } from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_404,
  ERROR_422,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const VotePollRequest = z.object({
  choices: z.number().array().min(1)
})

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'voteMastodonPoll',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    const parsed = VotePollRequest.safeParse(await req.json())
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const encodedPollId = (await params).id
    const statusId = idToUrl(encodedPollId)
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

    const { choices } = parsed.data
    const hasVoted = await database.hasActorVoted({
      statusId,
      actorId: currentActor.id
    })

    if (
      (status.pollType === 'oneOf' && hasVoted) ||
      (status.pollType === 'oneOf' && choices.length > 1)
    ) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    await Promise.all(
      choices.map((choice) =>
        database.createPollAnswer({
          statusId,
          actorId: currentActor.id,
          choice
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
    if (!updatedStatus || updatedStatus.type !== StatusType.enum.Poll) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const mastodonStatus = await getMastodonStatus(
      database,
      updatedStatus,
      currentActor.id
    )
    if (!mastodonStatus?.poll) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: mastodonStatus.poll
    })
  })
)
