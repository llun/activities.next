import { sendPollVotes } from '@/lib/activities'
import { StatusType } from '@/lib/models/status'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

import { VotePollRequest } from './types'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = AuthenticatedGuard(async (req, context) => {
  const { database, currentActor } = context
  const body = await req.json()
  const { statusId, choices } = VotePollRequest.parse(body)

  const status = await database.getStatus({ statusId, withReplies: false })
  if (!status || status.type !== StatusType.enum.Poll) {
    return apiErrorResponse(404, { error: 'Poll not found' })
  }

  if (Date.now() > status.endAt) {
    return apiErrorResponse(422, { error: 'Poll has closed' })
  }

  const hasVoted = await database.hasActorVoted({
    statusId,
    actorId: currentActor.id
  })

  if (status.pollType === 'oneOf' && hasVoted) {
    return apiErrorResponse(422, { error: 'Already voted' })
  }

  if (status.pollType === 'oneOf' && choices.length > 1) {
    return apiErrorResponse(422, {
      error: 'Single-choice poll allows only one selection'
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
      database.incrementPollChoiceVotes({
        statusId,
        choiceIndex
      })
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
