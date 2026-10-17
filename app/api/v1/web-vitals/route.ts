import { NextRequest } from 'next/server'

import { getWebVitalsConfig } from '@/lib/config'
import { createWindowCounter } from '@/lib/services/gallery/lookups/rateLimit'
import { hasSameOriginProofQuietly } from '@/lib/services/guards/sameOriginProof'
import { WebVitalsReportSchema } from '@/lib/services/webVitals/schema'
import {
  isRequestBodyTooLargeError,
  readRequestTextWithLimit
} from '@/lib/utils/boundedRequestBody'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { VERSION } from '@/lib/utils/version'
import { WEB_VITALS_MAX_REPORT_BYTES } from '@/lib/utils/webVitals/types'

const WINDOW_MS = 60_000
const COUNTER_KEY = 'reports'

let counter: ReturnType<typeof createWindowCounter> | undefined
let counterLimit = 0
let lastDropWarningWindow = -1

const getCounter = (limit: number) => {
  if (!counter || counterLimit !== limit) {
    counter = createWindowCounter({ limit, windowMs: WINDOW_MS, maxKeys: 1 })
    counterLimit = limit
  }
  return counter
}

// Both an accepted and a dropped report answer 202, so a client cannot tell a
// full window from a stored report and has nothing to retry.
const accepted = (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: [],
    data: { status: 'Accepted' },
    responseStatusCode: HTTP_STATUS.ACCEPTED
  })

// Browser telemetry from sampled page loads, so like /health it skips
// traceApiRoute: a span per beacon would only flood tracing.
export const POST = async (req: NextRequest) => {
  const { sampleRate, maxReportsPerMinute } = getWebVitalsConfig()
  if (sampleRate <= 0) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

  if (!hasSameOriginProofQuietly(req)) {
    return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
  }

  // Before the body is read: a full window costs no parsing at all.
  if (!getCounter(maxReportsPerMinute).tryHit(COUNTER_KEY)) {
    const window = Math.floor(Date.now() / WINDOW_MS)
    if (window !== lastDropWarningWindow) {
      lastDropWarningWindow = window
      logger.warn({
        message: 'Dropping Web Vitals reports over the per-minute cap',
        maxReportsPerMinute
      })
    }
    return accepted(req)
  }

  let payload: unknown
  try {
    payload = JSON.parse(
      await readRequestTextWithLimit(req, WEB_VITALS_MAX_REPORT_BYTES)
    )
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
    }
    return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
  }

  const parsed = WebVitalsReportSchema.safeParse(payload)
  if (!parsed.success) {
    return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
  }

  // One line per metric, the fields spelled out: the schema is strict, but the
  // log line should not depend on that to stay free of anything else.
  for (const metric of parsed.data.metrics) {
    logger.info({
      message: 'web-vitals',
      webVitals: {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        route: metric.route,
        device: metric.device,
        navigationType: metric.navigationType
      },
      release: VERSION
    })
  }

  return accepted(req)
}
