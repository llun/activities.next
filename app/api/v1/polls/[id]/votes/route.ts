import { z } from 'zod'

import { sendPollVotes } from '@/lib/activities'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Scope } from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_400,
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
  choices: z.number().int().nonnegative().array().min(1)
})

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'voteMastodonPoll',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    let body: unknown
    try {
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

    const encodedPollId = (await params).id
    const statusId = idToUrl(encodedPollId)
    const status = await database.getStatus({
      statusId,
      currentActorId: currentActor.id,
      withReplies: false
    })
    if (!status || status.type !== StatusType.enum.Poll) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    const hasAccess = await canActorReadStatus({
      database,
      status,
      currentActor
    })
    if (!hasAccess) {
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

    const choices = [...new Set(parsed.data.choices)]
    const hasVoted = await database.hasActorVoted({
      statusId,
      actorId: currentActor.id
    })
    const hasValidChoices = choices.every(
      (choice) => choice < status.choices.length
    )

    if (
      hasVoted ||
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
      currentActorId: currentActor.id,
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
