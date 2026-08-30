import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { getDatabase } from '@/lib/database'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getHeadersValue } from '@/lib/services/guards/getHeaderValue'
import { extractActivityPubId, normalizeActorId } from '@/lib/utils/activitypub'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  StatusCode,
  apiErrorResponse,
  apiResponse,
  codeMap
} from '@/lib/utils/response'
import { parse, verify } from '@/lib/utils/signature'
import { isRecord } from '@/lib/utils/typeGuards'

import { getSenderPublicKeyDetails } from './getSenderPublicKey'
import { headerHost } from './headerHost'
import {
  annotateInboxForwarded,
  annotateInboxRejection,
  getActivityTraceAttributes
} from './inboxRejectionTrace'
import { ActivityPubVerifiedSenderHandle, AppRouterParams } from './types'

// signed_request.rb:4-5 (EXPIRATION_WINDOW_LIMIT = 12.hours, CLOCK_SKEW_MARGIN = 1.hour)
const EXPIRATION_WINDOW_LIMIT_MS = 12 * 60 * 60 * 1000
const CLOCK_SKEW_MARGIN_MS = 1 * 60 * 60 * 1000

// activity.rb:8 (MAX_JSON_SIZE = 1.megabyte)
const MAX_ACTIVITY_JSON_BYTES = 1024 * 1024

const guardErrorResponse = (
  request: NextRequest,
  statusCode: StatusCode,
  allowedMethods?: HttpMethod[]
) => {
  if (!allowedMethods) return apiErrorResponse(statusCode)

  return apiResponse({
    req: request,
    allowedMethods,
    data: codeMap[statusCode],
    responseStatusCode: statusCode
  })
}

const rejectRequest = (
  request: NextRequest,
  statusCode: StatusCode,
  allowedMethods: HttpMethod[] | undefined,
  reason: string,
  extra?: Record<string, string | number | boolean | string[] | undefined>
) => {
  annotateInboxRejection(reason, extra)
  return guardErrorResponse(request, statusCode, allowedMethods)
}

const getSignedHeaders = (signatureParts: Record<string, string>) => {
  const algorithm = (signatureParts.algorithm ?? 'hs2019').toLowerCase()
  const defaultHeaders = algorithm === 'hs2019' ? '(created)' : 'date'
  return (signatureParts.headers ?? defaultHeaders)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

const hasRequiredSignedHeaders = (signedHeaders: string[], method: string) => {
  const upperMethod = method.toUpperCase()
  const hasDateOrCreated =
    signedHeaders.includes('date') || signedHeaders.includes('(created)')
  const hasDigestOrTarget =
    signedHeaders.includes('digest') ||
    signedHeaders.includes('(request-target)')

  if (!hasDateOrCreated || !hasDigestOrTarget) return false
  if (upperMethod === 'POST' && !signedHeaders.includes('digest')) return false
  if (upperMethod === 'GET' && !signedHeaders.includes('host')) return false

  return true
}

const getExpectedSha256Digest = (digestHeader: string) =>
  digestHeader
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf('=')
      if (separatorIndex === -1) return null

      return {
        algorithm: part.slice(0, separatorIndex).trim().toLowerCase(),
        value: part.slice(separatorIndex + 1).trim()
      }
    })
    .find((part) => part?.algorithm === 'sha-256')?.value

type PostActivityResult =
  | { actor: string; body: Record<string, unknown>; valid: true }
  | {
      actor: null
      body: Record<string, unknown> | null
      error: string
      valid: false
    }
  | { actor: null; body: null; valid: true }

const getPostActivity = ({
  bodyText,
  method
}: {
  bodyText: string | null
  method: string
}): PostActivityResult => {
  if (method.toUpperCase() !== 'POST') {
    return { actor: null, body: null, valid: true }
  }

  try {
    if (bodyText === null) {
      return { actor: null, body: null, error: 'body_missing', valid: false }
    }

    let body: unknown
    try {
      body = JSON.parse(bodyText) as unknown
    } catch {
      return {
        actor: null,
        body: null,
        error: 'json_parse_error',
        valid: false
      }
    }

    if (!isRecord(body)) {
      return {
        actor: null,
        body: null,
        error: 'not_an_object',
        valid: false
      }
    }

    const actor = extractActivityPubId(body.actor)
    if (!actor) {
      return { actor: null, body, error: 'missing_actor', valid: false }
    }
    if (!normalizeActorId(actor)) {
      return { actor: null, body, error: 'invalid_actor', valid: false }
    }

    return { actor, body: { ...body, actor }, valid: true }
  } catch {
    return {
      actor: null,
      body: null,
      error: 'unexpected_error',
      valid: false
    }
  }
}

const getSignatureTimes = (
  headers: Headers,
  signatureParts: Record<string, string>,
  signedHeaders: string[]
) => {
  const algorithm = (signatureParts.algorithm ?? 'hs2019').toLowerCase()
  let createdTimeMs: number | null = null

  if (
    algorithm === 'hs2019' &&
    signatureParts.created &&
    signedHeaders.includes('(created)')
  ) {
    const createdSec = parseInt(signatureParts.created, 10)
    if (!Number.isNaN(createdSec)) {
      createdTimeMs = createdSec * 1000
    }
  } else if (signedHeaders.includes('date')) {
    const dateHeader = getHeadersValue(headers, 'date')
    if (dateHeader && !Array.isArray(dateHeader)) {
      const parsed = Date.parse(dateHeader)
      if (!Number.isNaN(parsed)) {
        createdTimeMs = parsed
      }
    }
  }

  let expiresTimeMs: number | null = null
  if (signatureParts.expires) {
    const expiresSec = parseInt(signatureParts.expires, 10)
    if (!Number.isNaN(expiresSec)) {
      expiresTimeMs = expiresSec * 1000
    }
  }

  return { createdTimeMs, expiresTimeMs }
}

const isSignatureFresh = (
  headers: Headers,
  signatureParts: Record<string, string>,
  signedHeaders: string[],
  now = Date.now()
) => {
  const { createdTimeMs, expiresTimeMs } = getSignatureTimes(
    headers,
    signatureParts,
    signedHeaders
  )
  if (createdTimeMs === null) return false

  let effectiveExpiryMs = createdTimeMs + EXPIRATION_WINDOW_LIMIT_MS
  if (expiresTimeMs !== null) {
    effectiveExpiryMs = Math.min(
      expiresTimeMs,
      createdTimeMs + EXPIRATION_WINDOW_LIMIT_MS
    )
  }

  if (createdTimeMs > now + CLOCK_SKEW_MARGIN_MS) {
    return false
  }
  if (now > effectiveExpiryMs + CLOCK_SKEW_MARGIN_MS) {
    return false
  }

  return true
}

const digestMatches = async (request: NextRequest, signedHeaders: string[]) => {
  const digestHeader = getHeadersValue(request.headers, 'digest')
  if (!digestHeader)
    return {
      bodyText: null,
      valid: ['GET', 'HEAD'].includes(request.method.toUpperCase())
    }
  if (Array.isArray(digestHeader)) return { bodyText: null, valid: false }
  if (!signedHeaders.includes('digest')) return { bodyText: null, valid: false }

  const expectedDigest = getExpectedSha256Digest(digestHeader)
  if (!expectedDigest) return { bodyText: null, valid: false }

  const bodyBuffer = Buffer.from(await request.clone().arrayBuffer())
  const actualDigest = crypto
    .createHash('sha256')
    .update(bodyBuffer)
    .digest('base64')

  const actualDigestBuffer = Buffer.from(actualDigest, 'base64')
  const expectedDigestBuffer = Buffer.from(expectedDigest, 'base64')

  if (actualDigestBuffer.length !== expectedDigestBuffer.length) {
    return { bodyText: null, valid: false }
  }

  return {
    bodyText: bodyBuffer.toString('utf8'),
    valid: crypto.timingSafeEqual(actualDigestBuffer, expectedDigestBuffer)
  }
}

export const ActivityPubVerifySenderGuard =
  <P>(
    handle: ActivityPubVerifiedSenderHandle<P>,
    allowedMethods?: HttpMethod[]
  ) =>
  async (request: NextRequest, context: AppRouterParams<P>) => {
    const database = getDatabase()
    if (!database) return guardErrorResponse(request, 500, allowedMethods)

    const contentLength = request.headers.get('content-length')
    if (contentLength !== null) {
      const parsedContentLength = parseInt(contentLength, 10)
      if (
        !Number.isNaN(parsedContentLength) &&
        parsedContentLength > MAX_ACTIVITY_JSON_BYTES
      ) {
        return rejectRequest(
          request,
          413,
          allowedMethods,
          'payload_too_large',
          { content_length: parsedContentLength }
        )
      }
    }

    const requestSignature = request.headers.get('signature')
    if (!requestSignature)
      return rejectRequest(request, 401, allowedMethods, 'missing_signature')

    const signatureParts = await parse(requestSignature)
    if (!signatureParts.keyId) {
      return rejectRequest(
        request,
        401,
        allowedMethods,
        'unparseable_signature'
      )
    }
    const signedHeaders = getSignedHeaders(signatureParts)

    if (!hasRequiredSignedHeaders(signedHeaders, request.method)) {
      return rejectRequest(
        request,
        401,
        allowedMethods,
        'missing_signed_headers',
        {
          signed_headers: signedHeaders
        }
      )
    }

    if (!isSignatureFresh(request.headers, signatureParts, signedHeaders)) {
      const dateHeader = getHeadersValue(request.headers, 'date')
      const rawDate =
        typeof dateHeader === 'string'
          ? dateHeader
          : Array.isArray(dateHeader)
            ? dateHeader.join(', ')
            : undefined

      return rejectRequest(request, 401, allowedMethods, 'stale_date', {
        date_header: rawDate,
        created_param: signatureParts.created,
        server_time: new Date().toISOString()
      })
    }

    const digestResult = await digestMatches(request, signedHeaders)
    if (!digestResult.valid) {
      return rejectRequest(request, 401, allowedMethods, 'digest_mismatch')
    }

    const activity = getPostActivity({
      bodyText: digestResult.bodyText,
      method: request.method
    })
    if (!activity.valid) {
      // ActivityPub requires verifying that the HTTP signature's key owner
      // matches the activity's actor. An unparseable or actor-less body cannot
      // be bound to the signature, making it an authentication failure at the
      // HTTP layer, not a malformed-body client error. Returning 401 gives
      // compliant peers (Mastodon) a retryable signal rather than permanently
      // dropping the activity.
      logger.warn({
        message:
          'Invalid activity body received during HTTP signature verification',
        error: activity.error,
        keyId: signatureParts.keyId
      })
      return rejectRequest(
        request,
        401,
        allowedMethods,
        'invalid_activity_body',
        {
          error: activity.error,
          key_id: signatureParts.keyId,
          ...getActivityTraceAttributes(activity.body)
        }
      )
    }

    // Fast-path: mirror Mastodon inboxes_controller.rb:29-38 (unknown_affected_account?)
    // If Delete or Update of self-actor and actor does not exist in local DB,
    // return 202 immediately before key fetch / verification.
    if (activity.body && isRecord(activity.body) && activity.actor) {
      const rawType = activity.body.type
      const isDeleteOrUpdate =
        typeof rawType === 'string'
          ? rawType === 'Delete' || rawType === 'Update'
          : Array.isArray(rawType) &&
            (rawType.includes('Delete') || rawType.includes('Update'))

      if (isDeleteOrUpdate) {
        const rawObject = activity.body.object
        const objectId =
          typeof rawObject === 'string'
            ? rawObject
            : isRecord(rawObject) && typeof rawObject.id === 'string'
              ? rawObject.id
              : undefined

        if (objectId && objectId === activity.actor) {
          const existingActor = await database.getActorFromId({
            id: activity.actor
          })
          if (!existingActor) {
            const activityTypeStr =
              typeof rawType === 'string'
                ? rawType
                : Array.isArray(rawType)
                  ? rawType
                      .filter((t): t is string => typeof t === 'string')
                      .join(',')
                  : undefined
            annotateInboxRejection('unknown_actor_delete', {
              actor: activity.actor,
              activity_type: activityTypeStr,
              ...getActivityTraceAttributes(activity.body)
            })
            return guardErrorResponse(request, 202, allowedMethods)
          }
        }
      }
    }

    if (!(await canFederateWithDomain(database, signatureParts.keyId))) {
      return rejectRequest(
        request,
        403,
        allowedMethods,
        'domain_not_federatable',
        {
          key_id: signatureParts.keyId,
          ...getActivityTraceAttributes(activity.body)
        }
      )
    }

    const host = headerHost(request.headers)
    const requestUrl = new URL(request.url, `http://${host}`)
    const requestTarget = `${request.method.toLowerCase()} ${requestUrl.pathname}${requestUrl.search}`
    const senderPublicKey = await getSenderPublicKeyDetails(
      database,
      signatureParts.keyId
    )
    const isSignatureVerified = await verify(
      requestTarget,
      request.headers,
      senderPublicKey.publicKey
    )
    if (!isSignatureVerified) {
      const reason = senderPublicKey.publicKey
        ? 'signature_invalid'
        : 'key_unavailable'
      return rejectRequest(request, 401, allowedMethods, reason, {
        key_id: signatureParts.keyId,
        ...getActivityTraceAttributes(activity.body)
      })
    }

    const verifiedSenderActorId = normalizeActorId(senderPublicKey.owner)
    if (!verifiedSenderActorId) {
      return rejectRequest(
        request,
        401,
        allowedMethods,
        'key_owner_unresolvable',
        {
          key_id: signatureParts.keyId,
          key_owner: senderPublicKey.owner ?? undefined,
          ...getActivityTraceAttributes(activity.body)
        }
      )
    }

    let forwarded = false
    if (activity.actor) {
      const normalizedActor = normalizeActorId(activity.actor)

      if (verifiedSenderActorId !== normalizedActor) {
        // ActivityPub inbox forwarding (AP §7.1.2): a server re-delivers a
        // third party's activity verbatim, signed with its OWN user's key, so
        // the HTTP signer legitimately differs from the activity's actor
        // (Mastodon does this for replies and deletes in threads). The
        // signature above authenticated the FORWARDER; nothing here
        // authenticated the activity's actor. Hand the handler the forwarded
        // flag so it routes the activity through origin re-fetch verification
        // instead of trusting the payload — never 403, which Mastodon treats
        // as an unsalvageable delivery failure and which permanently dropped
        // every forwarded reply and delete.
        forwarded = true
        annotateInboxForwarded({
          verifiedSender: verifiedSenderActorId,
          activityActor: normalizedActor ?? undefined
        })
      }
    }

    return handle(request, {
      activityBody: activity.body,
      database,
      forwarded,
      params: context.params,
      verifiedSenderActorId
    })
  }
