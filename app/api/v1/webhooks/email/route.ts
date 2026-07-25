import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { REPLY_BY_EMAIL_JOB_NAME } from '@/lib/jobs/names'
import { InboundEmailPayload } from '@/lib/services/email/inboundPayload'
import { findReplyTokenInRecipients } from '@/lib/services/email/replyToken'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { timingSafeStringEqual } from '@/lib/utils/timingSafeStringEqual'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// `t=<unix-seconds>,v1=<hex>` where v1 = HMAC-SHA256(secret, "<t>.<rawBody>").
// Signing the timestamp *with* the body is what bounds replay: a signature over
// the body alone stays valid forever.
const SIGNATURE_HEADER = 'x-activities-signature'
const SIGNATURE_TOLERANCE_SECONDS = 300

// Attachments arrive base64-encoded inside the JSON, which inflates them by
// about a third, so this is roughly a 7 MB message. Beyond that the request is
// refused rather than buffered — every provider caps inbound mail well below
// this anyway.
const MAX_BODY_BYTES = 10 * 1024 * 1024

interface ParsedSignature {
  timestamp: string
  seconds: number
  signature: string
}

const parseSignatureHeader = (
  header: string | null
): ParsedSignature | null => {
  if (!header) return null

  let timestamp: string | null = null
  let signature: string | null = null
  for (const part of header.split(',')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key === 't') timestamp = value
    if (key === 'v1') signature = value
  }
  if (!timestamp || !signature) return null

  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds)) return null

  return { timestamp, seconds, signature }
}

const isValidSignature = (
  parsed: ParsedSignature,
  rawBody: string,
  secret: string
) => {
  // The exact timestamp string is signed, not the parsed number, so a signer
  // that pads or formats it differently still verifies.
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest('hex')
  return timingSafeStringEqual(expected, parsed.signature)
}

export const POST = traceApiRoute(
  'inboundEmailWebhook',
  async (req: NextRequest) => {
    // 404, not 403: an unconfigured feature should not advertise that it exists,
    // matching the Strava webhook and the QStash callback.
    const { email, emailInbound } = getConfig()
    if (!email || !emailInbound) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    const declaredLength = Number(req.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
    }

    // The raw text has to be read before parsing: the signature covers the exact
    // bytes, and re-serializing parsed JSON would not reproduce them.
    const rawBody = await req.text()
    if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
      return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
    }

    const signature = parseSignatureHeader(req.headers.get(SIGNATURE_HEADER))
    if (!signature) return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)

    const skewSeconds = Math.abs(Date.now() / 1000 - signature.seconds)
    if (skewSeconds > SIGNATURE_TOLERANCE_SECONDS) {
      logger.warn({ message: 'Inbound email webhook signature is stale' })
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }
    if (!isValidSignature(signature, rawBody, emailInbound.secret)) {
      logger.warn({ message: 'Inbound email webhook signature mismatch' })
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    let json: unknown
    try {
      json = JSON.parse(rawBody)
    } catch {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = InboundEmailPayload.safeParse(json)
    if (!parsed.success) {
      logger.warn({
        message: 'Invalid inbound email webhook payload',
        error: parsed.error.issues
      })
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }
    const payload = parsed.data

    const token = findReplyTokenInRecipients([...payload.to, ...payload.cc])
    if (!token) {
      logger.warn({
        message: 'Inbound email carries no reply address for this instance'
      })
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    // Answer as soon as the request is known to be genuine and well-formed. All
    // the slow work — WebFinger lookups, media storage, federation — happens in
    // the job, so a provider is never held open waiting for it. (Under NoQueue
    // `publish` runs the handler inline, so that deployment does pay for it here.)
    await getQueue().publish({
      id: getHashFromString(
        `email-reply:${payload.messageId ?? crypto.createHash('sha256').update(rawBody).digest('hex')}`
      ),
      name: REPLY_BY_EMAIL_JOB_NAME,
      data: {
        token,
        from: payload.from,
        messageId: payload.messageId,
        text: payload.text,
        html: payload.html,
        attachments: payload.attachments
      }
    })

    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { status: 'Accepted' },
      responseStatusCode: HTTP_STATUS.ACCEPTED
    })
  }
)
