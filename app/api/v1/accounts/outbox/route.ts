/**

 * @deprecated Use POST /api/v1/statuses for creating and DELETE /api/v1/statuses/:id for deleting
 * This custom endpoint is maintained for backward compatibility.
 */
import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { resolveQuoteForCreate } from '@/lib/services/quotes/resolveQuoteForCreate'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { validateStatusContentLimits } from '@/lib/services/statuses/contentLimits'
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
      // Enforce the admin-configured status/poll limits (server settings), the
      // same way POST /api/v1/statuses and PUT /api/v1/statuses/:id do. This is
      // the endpoint the web composer creates through, so without it the
      // resolved `posts.maxCharacters` was advertised and shown in the composer
      // but never actually enforced on a create.
      const serverSettings = await getResolvedServerSettings(database)
      const limitError = validateStatusContentLimits(
        request.type === 'poll'
          ? {
              status: request.message,
              poll: {
                options: request.choices,
                expires_in: request.durationInSeconds
              }
            }
          : { status: request.message },
        serverSettings
      )
      if (limitError) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: limitError },
          responseStatusCode: 422
        })
      }

      switch (request.type) {
        case 'note': {
          const {
            message,
            contentWarning,
            replyStatus,
            attachments,
            fitnessFileId,
            quotedStatusId: quotedStatusIdInput,
            quoteApprovalPolicy: requestedQuotePolicy,
            visibility
          } = request
          // Authorize the quote target (if any) and default the new status's
          // quote policy, mirroring POST /api/v1/statuses.
          const quoteResolution = await resolveQuoteForCreate({
            database,
            currentActor,
            quotedStatusId: quotedStatusIdInput,
            requestedPolicy: requestedQuotePolicy
          })
          if (!quoteResolution.ok) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data:
                quoteResolution.reason === 'not_found' ? ERROR_404 : ERROR_422,
              responseStatusCode:
                quoteResolution.reason === 'not_found' ? 404 : 422
            })
          }
          const status = await createNoteFromUserInput({
            currentActor,
            text: message,
            summary: contentWarning,
            replyNoteId: replyStatus?.id,
            attachments,
            fitnessFileId,
            quotedStatusId: quoteResolution.quotedStatusId,
            quoteApprovalPolicy: quoteResolution.quoteApprovalPolicy,
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
