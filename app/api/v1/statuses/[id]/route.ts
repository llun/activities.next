import { z } from 'zod'

import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { updateNoteVisibilityFromUserInput } from '@/lib/actions/updateNoteVisibility'
import {
  OAuthGuard,
  OptionalOAuthGuard
} from '@/lib/services/guards/OAuthGuard'
import { MAX_STATUS_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { getAttachmentsFromMediaIds } from '@/lib/services/statuses/mediaIds'
import { Scope } from '@/lib/types/database/operations'
import { isFitnessAttachment } from '@/lib/types/domain/attachment'
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
  OptionalOAuthGuard<Params>([Scope.enum.read], async (req, context) => {
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

    const status = await database.getStatus({
      statusId,
      currentActorId: currentActor?.id
    })
    if (!status)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    const hasAccess = await canActorReadStatus({
      database,
      status,
      currentActor
    })
    if (!hasAccess)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    const mastodonStatus = await getMastodonStatus(
      database,
      status,
      currentActor?.id
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
  spoiler_text: z.string().nullish(),
  media_ids: z.array(z.coerce.string()).optional(),
  visibility: z.enum(['public', 'unlisted', 'private', 'direct']).optional()
})

const isFitnessStatusAttachment = (attachment: {
  mediaType: string
  url: string
  name?: string | null
}) =>
  isFitnessAttachment({
    mediaType: attachment.mediaType,
    url: attachment.url,
    name: attachment.name ?? ''
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
      const parsed = EditNoteSchema.safeParse(await req.json())
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }
      const changes = parsed.data
      const mediaIds =
        changes.media_ids === undefined
          ? undefined
          : [...new Set(changes.media_ids)]
      if (
        mediaIds !== undefined &&
        mediaIds.length > MAX_STATUS_MEDIA_ATTACHMENTS
      ) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      let updatedNote

      const shouldUpdateContent =
        changes.status !== undefined ||
        changes.spoiler_text !== undefined ||
        mediaIds !== undefined
      const visibility = changes.visibility

      if (!shouldUpdateContent && visibility === undefined) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const existingStatus = await database.getStatus({ statusId })
      if (
        !existingStatus ||
        existingStatus.type !== StatusType.enum.Note ||
        existingStatus.actorId !== currentActor.id
      ) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_403,
          responseStatusCode: 403
        })
      }

      const attachments =
        mediaIds === undefined
          ? undefined
          : await getAttachmentsFromMediaIds(database, currentActor, mediaIds)
      if (attachments === null) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }
      const changesTextOrMedia =
        changes.status !== undefined || mediaIds !== undefined
      if (changesTextOrMedia) {
        const effectiveText =
          changes.status === undefined ? existingStatus.text : changes.status
        const effectiveAttachments = (
          attachments === undefined
            ? existingStatus.attachments
            : [
                ...attachments,
                ...existingStatus.attachments.filter(
                  (attachment) =>
                    (attachment.mediaId === null ||
                      attachment.mediaId === undefined) &&
                    !isFitnessStatusAttachment(attachment)
                )
              ]
        ).filter((attachment) => !isFitnessStatusAttachment(attachment))

        if (
          effectiveText.trim().length === 0 &&
          effectiveAttachments.length === 0
        ) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_422,
            responseStatusCode: 422
          })
        }
      }

      if (visibility !== undefined) {
        updatedNote = await updateNoteVisibilityFromUserInput({
          statusId,
          currentActor,
          visibility,
          publish: !shouldUpdateContent,
          status: existingStatus,
          database
        })
        if (!updatedNote)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_403,
            responseStatusCode: 403
          })
      }

      if (shouldUpdateContent) {
        updatedNote = await updateNoteFromUserInput({
          statusId,
          currentActor,
          text: changes.status,
          summary: changes.spoiler_text,
          attachments,
          publish: true,
          status:
            updatedNote?.type === StatusType.enum.Note
              ? updatedNote
              : existingStatus,
          database
        })
        if (!updatedNote)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_403,
            responseStatusCode: 403
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
