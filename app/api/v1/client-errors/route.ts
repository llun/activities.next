import { NextRequest } from 'next/server'

import {
  sanitiseClientErrorPathname,
  sanitiseClientErrorStack,
  sanitiseClientErrorText
} from '@/lib/services/clientErrors/sanitize'
import { ClientErrorSchema } from '@/lib/services/clientErrors/schema'
import { createWindowCounter } from '@/lib/services/gallery/lookups/rateLimit'
import { hasSameOriginProofQuietly } from '@/lib/services/guards/sameOriginProof'
import {
  SMALL_REQUEST_BODY_MAX_BYTES,
  isRequestBodyTooLargeError,
  readRequestTextWithLimit
} from '@/lib/utils/boundedRequestBody'
import { getTrustedClientIp } from '@/lib/utils/getTrustedClientIp'
import { logger } from '@/lib/utils/logger'
import {
  DEFAULT_202,
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const WINDOW_MS = 60_000
const PER_IP_LIMIT = 10
const GLOBAL_LIMIT = 60
const ipCounter = createWindowCounter({
  limit: PER_IP_LIMIT,
  windowMs: WINDOW_MS,
  maxKeys: 10_000
})

const globalCounter = createWindowCounter({
  limit: GLOBAL_LIMIT,
  windowMs: WINDOW_MS,
  maxKeys: 1
})

export const POST = traceApiRoute('clientErrors', async (req: NextRequest) => {
  if (!hasSameOriginProofQuietly(req)) {
    return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
  }

  const clientIp = getTrustedClientIp(req)
  if (clientIp) {
    if (!ipCounter.tryHit(clientIp)) {
      return apiErrorResponse(HTTP_STATUS.TOO_MANY_REQUESTS)
    }
  }

  if (!globalCounter.tryHit('global')) {
    return apiErrorResponse(HTTP_STATUS.TOO_MANY_REQUESTS)
  }

  const contentType = req.headers.get('content-type')
  if (!contentType || !/^application\/json(;.*)?$/i.test(contentType.trim())) {
    return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
  }

  let rawBody: string
  try {
    rawBody = await readRequestTextWithLimit(req, SMALL_REQUEST_BODY_MAX_BYTES)
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
    }
    return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
  }

  const parsed = ClientErrorSchema.safeParse(payload)
  if (!parsed.success) {
    return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
  }

  // Sanitize client-controlled strings before they enter structured logs.
  const {
    name: submittedName,
    message,
    stack,
    digest,
    pathname,
    source,
    userAgent,
    buildVersion
  } = parsed.data
  const name = sanitiseClientErrorText(submittedName ?? 'Error')
  const sanitisedMessage = sanitiseClientErrorText(message)
  const sanitisedPathname = sanitiseClientErrorPathname(pathname)
  const sanitisedStack = stack ? sanitiseClientErrorStack(stack) : undefined

  const header = `${name}: ${sanitisedMessage}`
  const err = new Error(sanitisedMessage)
  err.name = name
  if (sanitisedStack && sanitisedStack.trim().length > 0) {
    err.stack = sanitisedStack.startsWith(header)
      ? sanitisedStack
      : `${header}\n${sanitisedStack}`
  } else {
    err.stack = header
  }

  logger.error({
    message: `Client error: ${source}`,
    err,
    digest,
    pathname: sanitisedPathname,
    source,
    userAgent,
    buildVersion
  })

  return apiResponse({
    req,
    allowedMethods: [],
    data: DEFAULT_202,
    responseStatusCode: HTTP_STATUS.ACCEPTED
  })
})
