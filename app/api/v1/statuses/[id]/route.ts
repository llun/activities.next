import { z } from 'zod'

import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { updateNoteVisibilityFromUserInput } from '@/lib/actions/updateNoteVisibility'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { Scope } from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_400,
  ERROR_403,
  ERROR_404,
  ERROR_422,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

interface Params {
  id: string
}

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getStatus',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    const statusId = idToUrl(encodedStatusId)

    const status = await database.getStatus({ statusId })
    if (!status)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    const mastodonStatus = await getMastodonStatus(
      database,
      status,
      currentActor.id
    )
    if (!mastodonStatus)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: mastodonStatus
    })
  })
)

const EditNoteSchema = z.object({
  status: z.string().optional(),
  spoiler_text: z.string().optional(),
  visibility: z.enum(['public', 'unlisted', 'private', 'direct']).optional()
})

export const PUT = traceApiRoute(
  'updateStatus',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    const { database, currentActor } = context
    const statusId = idToUrl(encodedStatusId)
    try {
      const changes = EditNoteSchema.parse(await req.json())

      let updatedNote

      if (changes.visibility !== undefined && changes.status === undefined) {
        updatedNote = await updateNoteVisibilityFromUserInput({
          statusId,
          currentActor,
          visibility: changes.visibility,
          database
        })
      } else if (changes.status !== undefined) {
        updatedNote = await updateNoteFromUserInput({
          statusId,
          currentActor,
          text: changes.status,
          summary: changes.spoiler_text,
          database
        })
      } else {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      if (!updatedNote)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_403,
          responseStatusCode: 403
        })
      if (updatedNote.type === StatusType.enum.Announce) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      const mastodonStatus = await getMastodonStatus(
        database,
        updatedNote,
        currentActor.id
      )
      if (!mastodonStatus)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatus
      })
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
  })
)

export const DELETE = traceApiRoute(
  'deleteStatus',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    const statusId = idToUrl(encodedStatusId)
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    // Only owner can delete
    if (status.actorId !== currentActor.id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    // Get the status for return before deletion
    const mastodonStatus = await getMastodonStatus(
      database,
      status,
      currentActor.id
    )

    // Delete the status and send Delete activity
    await deleteStatusFromUserInput({ currentActor, statusId, database })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: mastodonStatus ?? {}
    })
  })
)
