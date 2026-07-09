import { z } from 'zod'

import { sendPollVotes } from '@/lib/activities'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Scope } from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
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
const MAX_POLL_CHOICES_PER_VOTE = 20

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Mastodon documents `choices` as an array of STRING indices, so accept numbers
// and non-blank numeric strings alike. Everything else becomes NaN and 422s:
// blanket `Number()` coercion maps '', ' ', null, false and [] all to 0, which
// would silently record a vote for option 0. This mirrors parseFormChoices.
const PollChoice = z.preprocess((value) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}, z.number().int().nonnegative())

const VotePollRequest = z.object({
  choices: PollChoice.array().min(1).max(MAX_POLL_CHOICES_PER_VOTE)
})

const parseFormChoices = (formData: Pick<FormData, 'getAll'>) => {
  const bracketChoices = formData.getAll('choices[]')
  const choices =
    bracketChoices.length > 0 ? bracketChoices : formData.getAll('choices')
  return {
    choices: choices.map((choice) =>
      typeof choice === 'string' && choice.trim() ? Number(choice) : Number.NaN
    )
  }
}

const parseVotePollRequestBody = async (req: Request): Promise<unknown> => {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return parseFormChoices(new URLSearchParams(await req.text()))
  }
  if (contentType.includes('multipart/form-data')) {
    return parseFormChoices(await req.formData())
  }

  return req.json()
}

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'voteMastodonPoll',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      let body: unknown
      try {
        body = await parseVotePollRequestBody(req)
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
    }
  )
)
