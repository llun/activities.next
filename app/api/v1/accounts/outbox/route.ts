/**
 * @deprecated Use POST /api/v1/statuses for creating and DELETE /api/v1/statuses/:id for deleting
 * This custom endpoint is maintained for backward compatibility.
 */
import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { toActivityPubObject } from '@/lib/models/status'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  DEFAULT_202,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { DeleteStatusRequest, PostRequest } from './types'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'getAccountOutbox',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const body = await req.json()
    try {
      const request = PostRequest.parse(body)
      switch (request.type) {
        case 'note': {
          const { message, replyStatus, attachments, visibility } = request
          const status = await createNoteFromUserInput({
            currentActor,
            text: message,
            replyNoteId: replyStatus?.id,
            attachments,
            visibility,
            database
          })
          if (!status) return apiErrorResponse(404)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: {
              status,
              note: toActivityPubObject(status),
              attachments: status.attachments
            }
          })
        }
        case 'poll': {
          const {
            message,
            replyStatus,
            choices,
            durationInSeconds,
            pollType,
            visibility
          } = request
          const endAt = Date.now() + durationInSeconds * 1000
          await createPollFromUserInput({
            currentActor,
            text: message,
            replyStatusId: replyStatus?.id,
            choices,
            endAt,
            pollType,
            visibility,
            database
          })
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { success: true }
          })
        }
        default: {
          return apiErrorResponse(404)
        }
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      logger.error(nodeError)
      return apiErrorResponse(400)
    }
  })
)

export const DELETE = traceApiRoute(
  'deleteAccountOutbox',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const body = await req.json()
    try {
      const request = DeleteStatusRequest.parse(body)
      await deleteStatusFromUserInput({
        currentActor,
        database,
        statusId: request.statusId
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: DEFAULT_202
      })
    } catch {
      return apiErrorResponse(400)
    }
  })
)
