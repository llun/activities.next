import { Mastodon } from '@llun/activities.schema'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

import { VotePollRequest } from './types'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = AuthenticatedGuard(async (req, context) => {
  const { database, currentActor, params } = context
  const pollId = params?.id

  if (!pollId || typeof pollId !== 'string') {
    return apiErrorResponse(404, { error: 'Poll not found' })
  }

  // Parse and validate request body
  let body: VotePollRequest
  try {
    const rawBody = await req.json()
    body = VotePollRequest.parse(rawBody)
  } catch (error) {
    return apiErrorResponse(422, { error: 'Invalid request body' })
  }

  const { choices } = body

  // Get the poll status
  const status = await database.getStatus({ statusId: pollId })
  if (!status || status.type !== 'Poll') {
    return apiErrorResponse(404, { error: 'Poll not found' })
  }

  // Check if poll has expired
  if (Date.now() > status.endAt) {
    return apiErrorResponse(422, { error: 'Poll has ended' })
  }

  // Validate choice index
  const choiceIndex = choices[0]
  if (choiceIndex < 0 || choiceIndex >= status.choices.length) {
    return apiErrorResponse(422, { error: 'Invalid choice' })
  }

  const selectedChoice = status.choices[choiceIndex]
  if (!selectedChoice.choiceId) {
    return apiErrorResponse(500, { error: 'Invalid poll choice data' })
  }

  // Check if actor has already voted
  const hasVoted = await database.hasActorVotedOnPoll({
    actorId: currentActor.id,
    statusId: pollId
  })

  if (hasVoted) {
    return apiErrorResponse(422, {
      error: 'You have already voted on this poll'
    })
  }

  // Create the vote and increment count in a transaction-like manner
  try {
    await database.createPollAnswer({
      actorId: currentActor.id,
      choiceId: selectedChoice.choiceId
    })

    await database.incrementPollChoiceVotes(selectedChoice.choiceId)
  } catch (error) {
    // If vote creation failed (e.g., duplicate), return error
    return apiErrorResponse(422, {
      error: 'Failed to record vote'
    })
  }

  // Get updated status with new vote counts
  const updatedStatus = await database.getStatus({ statusId: pollId })
  if (!updatedStatus || updatedStatus.type !== 'Poll') {
    return apiErrorResponse(500, { error: 'Failed to retrieve updated poll' })
  }

  // Get actor's votes for this poll
  const actorVotes = await database.getActorPollAnswers({
    actorId: currentActor.id,
    statusId: pollId
  })

  // Map vote choice IDs to indices
  const ownVoteIndices = actorVotes
    .map((vote) => {
      const index = updatedStatus.choices.findIndex(
        (c) => c.choiceId === vote.choice
      )
      return index
    })
    .filter((index) => index >= 0)

  // Build Mastodon Poll response
  const pollResponse = Mastodon.Poll.parse({
    id: urlToId(updatedStatus.id),
    expires_at: getISOTimeUTC(updatedStatus.endAt),
    expired: Date.now() > updatedStatus.endAt,
    multiple: false,
    votes_count: updatedStatus.choices.reduce(
      (sum, choice) => sum + choice.totalVotes,
      0
    ),
    voters_count: 0, // Not tracked currently
    options: updatedStatus.choices.map((choice) => ({
      title: choice.title,
      votes_count: choice.totalVotes
    })),
    emojis: [],
    voted: true,
    own_votes: ownVoteIndices
  })

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: pollResponse,
    status: 200
  })
})
