import { z } from 'zod'

import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { updateNoteVisibilityFromUserInput } from '@/lib/actions/updateNoteVisibility'
import {
  annotateMastodonStatusesWithFilters,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import {
  OAuthGuardAnyScope,
  OptionalOAuthGuard
} from '@/lib/services/guards/OAuthGuard'
import { MAX_STATUS_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { deleteMediaFile } from '@/lib/services/medias'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { getAttachmentsFromMediaIds } from '@/lib/services/statuses/mediaIds'
import { parseStatusRequestBody } from '@/lib/services/statuses/parseStatusRequestBody'
import { Scope } from '@/lib/types/database/operations'
import { isFitnessAttachment } from '@/lib/types/domain/attachment'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_400,
  ERROR_403,
  ERROR_422,
  ERROR_500,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'
import { Booleanish } from '@/lib/utils/zodBooleanish'

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
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)
      const statusId = idToUrl(encodedStatusId)

      const status = await database.getStatus({
        statusId,
        currentActorId: currentActor?.id
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)

      const hasAccess = await canActorReadStatus({
        database,
        status,
        currentActor
      })
      if (!hasAccess) return apiCorsError(req, CORS_HEADERS, 404)

      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        currentActor?.id
      )
      if (!mastodonStatus) return apiCorsError(req, CORS_HEADERS, 404)

      // Mastodon annotates the `filtered` field on single-status reads using
      // the `thread` filter context (the status detail view). Per-account
      // filters are skipped for unauthenticated requests, but instance-wide
      // server filters still apply to anonymous viewers (see getActiveFilters).
      const filterRecords = await getActiveFilters(
        database,
        currentActor?.id,
        'thread'
      )
      const [annotatedStatus] = annotateMastodonStatusesWithFilters(
        [mastodonStatus],
        [status],
        filterRecords
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: annotatedStatus
      })
    },
    { matchMode: 'any' }
  )
)

const EditNoteSchema = z.object({
  status: z.string().optional(),
  spoiler_text: z.string().nullish(),
  media_ids: z.array(z.coerce.string()).optional(),
  visibility: z.enum(['public', 'unlisted', 'private', 'direct']).optional(),
  language: z.string().trim().min(1).optional(),
  sensitive: Booleanish.optional()
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
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      const { database, currentActor } = context
      const statusId = idToUrl(encodedStatusId)
      try {
        const parsed = EditNoteSchema.safeParse(
          await parseStatusRequestBody(req)
        )
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
          mediaIds !== undefined ||
          changes.sensitive !== undefined ||
          changes.language !== undefined
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
            sensitive: changes.sensitive,
            language: changes.language,
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
    }
  )
)

export const DELETE = traceApiRoute(
  'deleteStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      const statusId = idToUrl(encodedStatusId)
      const status = await database.getStatus({ statusId, withReplies: false })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)

      // Only owner can delete
      if (status.actorId !== currentActor.id) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_403,
          responseStatusCode: 403
        })
      }

      // Mastodon's delete_media param: when truthy the status's uploaded media
      // is destroyed immediately instead of being kept for redrafting. An
      // absent param means false; Booleanish mirrors Mastodon's string
      // boolean coercion for query/form values.
      const deleteMediaRaw = new URL(req.url).searchParams.get('delete_media')
      const deleteMediaParsed = Booleanish.safeParse(deleteMediaRaw ?? 'false')
      const shouldDeleteMedia =
        deleteMediaParsed.success && deleteMediaParsed.data

      // Capture the media-manager ids before deletion — the attachment rows
      // are removed with the status. Fitness attachments are not media-manager
      // uploads and are never storage-deleted here.
      const mediaIdsToDelete =
        shouldDeleteMedia && status.type !== StatusType.enum.Announce
          ? [
              ...new Set(
                status.attachments
                  .filter(
                    (attachment) =>
                      !isFitnessStatusAttachment(attachment) &&
                      attachment.mediaId !== null &&
                      attachment.mediaId !== undefined
                  )
                  .map((attachment) => String(attachment.mediaId))
              )
            ]
          : []

      // Get the status for return before deletion
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        currentActor.id
      )

      // Delete the status and send Delete activity
      await deleteStatusFromUserInput({ currentActor, statusId, database })

      // With the status (and its attachment rows) gone, reuse the media-manager
      // DELETE flow: row + usage counters inside a transaction, then
      // best-effort storage cleanup. deleteMediaForAccount still reports
      // 'in-use' when the media is attached to another status, so shared media
      // is never destroyed from under a surviving status.
      const account = currentActor.account
      if (mediaIdsToDelete.length > 0 && account) {
        for (const mediaId of mediaIdsToDelete) {
          const result = await database.deleteMediaForAccount({
            mediaId,
            accountId: account.id
          })
          if (result.status !== 'deleted') {
            logger.warn({
              message: 'Skipped media cleanup while deleting status',
              statusId,
              mediaId,
              reason: result.status
            })
            continue
          }
          const deletions = await Promise.allSettled(
            result.files.map((filePath) => deleteMediaFile(database, filePath))
          )
          deletions.forEach((deletion, index) => {
            if (deletion.status === 'rejected' || !deletion.value) {
              logger.warn({
                message:
                  'Failed to delete storage file for deleted status media',
                filePath: result.files[index],
                statusId,
                mediaId
              })
            }
          })
        }
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatus ?? {}
      })
    }
  )
)
