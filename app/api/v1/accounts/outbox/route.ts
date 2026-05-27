/**

 * @deprecated Use POST /api/v1/statuses for creating and DELETE /api/v1/statuses/:id for deleting
 * This custom endpoint is maintained for backward compatibility.
 */
import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { toActivityPubObject } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  DEFAULT_202,
  ERROR_400,
  ERROR_404,
  ERROR_422,
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
    try {
      const body = await req.json()
      const parsed = PostRequest.safeParse(body)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }
      const request = parsed.data
      switch (request.type) {
        case 'note': {
          const {
            message,
            contentWarning,
            replyStatus,
            attachments,
            fitnessFileId,
            visibility
          } = request
          const status = await createNoteFromUserInput({
            currentActor,
            text: message,
            summary: contentWarning,
            replyNoteId: replyStatus?.id,
            attachments,
            fitnessFileId,
            visibility,
            database
          })
          if (!status)
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: ERROR_422,
              responseStatusCode: 422
            })
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
            contentWarning,
            replyStatus,
            choices,
            durationInSeconds,
            pollType,
            visibility
          } = request
          const endAt = Date.now() + durationInSeconds * 1000
          const status = await createPollFromUserInput({
            currentActor,
            text: message,
            summary: contentWarning,
            replyStatusId: replyStatus?.id,
            choices,
            endAt,
            pollType,
            visibility,
            database
          })
          if (!status) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: ERROR_422,
              responseStatusCode: 422
            })
          }
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { success: true }
          })
        }
        default: {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      logger.error(nodeError)
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
  'deleteAccountOutbox',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    try {
      const body = await req.json()
      const parsed = DeleteStatusRequest.safeParse(body)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }
      const request = parsed.data
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
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }
  })
)
