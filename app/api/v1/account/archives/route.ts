import { NextRequest } from 'next/server'
import { z } from 'zod'

import {
  ARCHIVE_LIST_LIMIT,
  ARCHIVE_REQUEST_INTERVAL_MS
} from '@/lib/services/accountArchive/constants'
import { expireArchiveIfDue } from '@/lib/services/accountArchive/expiry'
import { reapStuckAccountArchive } from '@/lib/services/accountArchive/reaper'
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

const readBodyWithLimit = async (
  req: Request,
  limit: number
): Promise<string | null> => {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const RequestBody = z.object({
  actorId: z.string().optional(),
  stripExactLocations: z.boolean().optional(),
  drafts: z.unknown().optional()
})

// The web client names the actor it loaded the page as (the query on GET,
// the JSON body on POST). A stale tab whose session now belongs to another
// account must not read or write this account's archives, so a mismatch is
// answered before anything runs. A request without actorId — an API
// client's — keeps working as before.
const actorIdMismatch = (req: NextRequest, actorId: string) => {
  const expected = new URL(req.url).searchParams.get('actorId')
  return Boolean(expected && expected !== actorId)
}

const actorChangedResponse = (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: { error: 'Actor changed' },
    responseStatusCode: HTTP_STATUS.CONFLICT
  })

export const GET = traceApiRoute(
  'listAccountArchives',
  AuthenticatedGuard(
    async (req, context) => {
      const { currentActor, database } = context
      if (actorIdMismatch(req, currentActor.id)) {
        return actorChangedResponse(req)
      }
      const accountId = currentActor.account?.id
      if (!accountId) return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)

      const archives = await database.getAccountArchivesForAccount({
        accountId,
        limit: ARCHIVE_LIST_LIMIT
      })
      const current = await Promise.all(
        archives.map(async (archive) =>
          reapStuckAccountArchive({
            database,
            archive: await expireArchiveIfDue({ database, archive })
          })
        )
      )
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: current.map(toArchiveResponse)
      })
    },
    { allowModerationBlocked: true }
  )
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
    // The header can be absent or wrong (chunked bodies), so the bytes are
    // counted as they arrive and the read stops at the cap.
    const text = await readBodyWithLimit(req, MAX_BODY_BYTES)
    if (text === null) return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)

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
    if (parsed.data.actorId && parsed.data.actorId !== currentActor.id) {
      return actorChangedResponse(req)
    }

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
    const rateLimited = (nextAllowedAt: number, extra: object = {}) => {
      const retryAfter = Math.max(
        1,
        Math.ceil((nextAllowedAt - Date.now()) / 1000)
      )
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          error: 'An archive was requested in the last 7 days',
          nextAllowedAt: new Date(nextAllowedAt).toISOString(),
          ...extra
        },
        responseStatusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
        additionalHeaders: [['Retry-After', String(retryAfter)]]
      })
    }
    switch (result.reason) {
      case 'rate-limited':
        return rateLimited(result.nextAllowedAt)
      case 'running':
        // One export at a time, and a new one only 7 days after the request.
        return rateLimited(
          result.archive.createdAt + ARCHIVE_REQUEST_INTERVAL_MS,
          { archive: toArchiveResponse(result.archive) }
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
