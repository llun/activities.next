import { z } from 'zod'

import { ARCHIVE_LIST_LIMIT } from '@/lib/services/accountArchive/constants'
import { expireArchiveIfDue } from '@/lib/services/accountArchive/expiry'
import { requestAccountArchive } from '@/lib/services/accountArchive/request'
import { toArchiveResponse } from '@/lib/services/accountArchive/serialize'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  type StatusCode,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// The drafts payload is capped at 5 MiB by `prepareArchiveDrafts`; this is the
// envelope around it, checked before the body is parsed.
const MAX_BODY_BYTES = 6 * 1024 * 1024

const RequestBody = z.object({
  stripExactLocations: z.boolean().optional(),
  drafts: z.unknown().optional()
})

export const GET = traceApiRoute(
  'listAccountArchives',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const accountId = currentActor.account?.id
    if (!accountId) return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)

    const archives = await database.getAccountArchivesForAccount({
      accountId,
      limit: ARCHIVE_LIST_LIMIT
    })
    const current = await Promise.all(
      archives.map((archive) => expireArchiveIfDue({ database, archive }))
    )
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: current.map(toArchiveResponse)
    })
  })
)

export const POST = traceApiRoute(
  'requestAccountArchive',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const accountId = currentActor.account?.id
    if (!accountId) return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)

    const length = Number(req.headers.get('content-length') ?? 0)
    if (length > MAX_BODY_BYTES) {
      return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
    }
    const text = await req.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
    }

    let json: unknown = {}
    if (text.trim().length > 0) {
      try {
        json = JSON.parse(text)
      } catch {
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }
    }
    const parsed = RequestBody.safeParse(json)
    if (!parsed.success) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    const result = await requestAccountArchive({
      database,
      accountId,
      options: { stripExactLocations: parsed.data.stripExactLocations },
      drafts: parsed.data.drafts
    })

    const respond = (data: unknown, responseStatusCode: StatusCode) =>
      apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data,
        responseStatusCode
      })

    if (result.ok) {
      return respond(toArchiveResponse(result.archive), HTTP_STATUS.ACCEPTED)
    }
    switch (result.reason) {
      case 'rate-limited':
        return respond(
          {
            error: 'An archive was requested in the last 7 days',
            nextAllowedAt: new Date(result.nextAllowedAt).toISOString()
          },
          HTTP_STATUS.TOO_MANY_REQUESTS
        )
      case 'running':
        return respond(
          {
            error: 'An archive is already being prepared',
            archive: toArchiveResponse(result.archive)
          },
          HTTP_STATUS.CONFLICT
        )
      case 'drafts-too-large':
        return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      case 'drafts-invalid':
        return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      default:
        return respond(
          { error: 'Archive export is not available on this server' },
          HTTP_STATUS.SERVICE_UNAVAILABLE
        )
    }
  })
)
