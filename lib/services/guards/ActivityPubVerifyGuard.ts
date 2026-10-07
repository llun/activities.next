import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { getDatabase } from '@/lib/database'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getHeadersValue } from '@/lib/services/guards/getHeaderValue'
import { extractActivityPubId, normalizeActorId } from '@/lib/utils/activitypub'
import { verifyContentDigest } from '@/lib/utils/contentDigest'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ParsedHttpMessageSignature,
  hasRequiredHttpMessageSignatureComponents,
  parseHttpMessageSignature,
  verifyHttpMessageSignature
} from '@/lib/utils/httpMessageSignature'
import { logger } from '@/lib/utils/logger'
import {
  StatusCode,
  apiErrorResponse,
  apiResponse,
  codeMap
} from '@/lib/utils/response'
import { parse, verify } from '@/lib/utils/signature'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { isRecord } from '@/lib/utils/typeGuards'

import {
  getSenderPublicKeyDetails,
  persistRefreshedSenderPublicKey,
  refreshSenderPublicKeyDetails
} from './getSenderPublicKey'
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

type RejectionAttributes = Record<
  string,
  string | number | boolean | string[] | undefined
>

const rejectRequest = (
  request: NextRequest,
  statusCode: StatusCode,
  allowedMethods: HttpMethod[] | undefined,
  reason: string,
  extra?: RejectionAttributes
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

// The one freshness window both signature schemes share: a signature is good
// for 12 hours from its creation (or until its own `expires`, if sooner), with
// an hour of clock skew either side.
const isWithinSignatureWindow = (
  createdTimeMs: number,
  expiresTimeMs: number | null,
  now = Date.now()
) => {
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

  return isWithinSignatureWindow(createdTimeMs, expiresTimeMs, now)
}

// Reads the body through a stream and gives up as soon as it passes
// `maxBytes`. The Content-Length check above only covers senders that declare
// one: a chunked body has none, and `arrayBuffer()` would buffer and hash all
// of it before the signature is ever checked. Returns null when over the cap.
const readBoundedBody = async (
  request: NextRequest,
  maxBytes: number
): Promise<Buffer | null> => {
  const stream = request.clone().body
  if (!stream) return Buffer.alloc(0)

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      // Not awaited: cancelling one branch of a cloned (tee'd) body settles
      // only once the other branch is cancelled too, which nothing here does.
      // Stopping the reads is what bounds the work.
      reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

type DigestResult = { bodyText: string | null; valid: boolean; tooLarge?: true }

const isBodylessMethod = (method: string) =>
  ['GET', 'HEAD'].includes(method.toUpperCase())

// A draft-cavage request is judged on its legacy `Digest`, but a sender that
// also sends an RFC 9530 `Content-Digest` must not be allowed to contradict
// it: a present one that disagrees with the body, or cannot be read, fails.
// One carrying only algorithms we do not support is ignored.
const contentDigestContradictsBody = (request: NextRequest, body: Buffer) => {
  const contentDigestHeader = request.headers.get('content-digest')
  if (contentDigestHeader === null) return false
  const result = verifyContentDigest(contentDigestHeader, body)
  return result === 'mismatch' || result === 'malformed'
}

const digestMatches = async (
  request: NextRequest,
  signedHeaders: string[]
): Promise<DigestResult> => {
  const digestHeader = getHeadersValue(request.headers, 'digest')
  if (!digestHeader)
    return { bodyText: null, valid: isBodylessMethod(request.method) }
  if (Array.isArray(digestHeader)) return { bodyText: null, valid: false }
  if (!signedHeaders.includes('digest')) return { bodyText: null, valid: false }

  const expectedDigest = getExpectedSha256Digest(digestHeader)
  if (!expectedDigest) return { bodyText: null, valid: false }

  const bodyBuffer = await readBoundedBody(request, MAX_ACTIVITY_JSON_BYTES)
  if (!bodyBuffer) return { bodyText: null, valid: false, tooLarge: true }
  const actualDigest = crypto
    .createHash('sha256')
    .update(bodyBuffer)
    .digest('base64')

  const actualDigestBuffer = Buffer.from(actualDigest, 'base64')
  const expectedDigestBuffer = Buffer.from(expectedDigest, 'base64')

  if (actualDigestBuffer.length !== expectedDigestBuffer.length) {
    return { bodyText: null, valid: false }
  }
  if (!crypto.timingSafeEqual(actualDigestBuffer, expectedDigestBuffer)) {
    return { bodyText: null, valid: false }
  }
  if (contentDigestContradictsBody(request, bodyBuffer)) {
    return { bodyText: null, valid: false }
  }

  return { bodyText: bodyBuffer.toString('utf8'), valid: true }
}

// RFC 9421 counterpart of `digestMatches`: the body is bound by an RFC 9530
// `Content-Digest` the signature covers, and it must match outright. A legacy
// `Digest` on the same request is not consulted.
const contentDigestMatches = async (
  request: NextRequest,
  components: string[]
): Promise<DigestResult> => {
  const contentDigestHeader = request.headers.get('content-digest')
  if (contentDigestHeader === null) {
    return { bodyText: null, valid: isBodylessMethod(request.method) }
  }
  if (!components.includes('content-digest')) {
    return { bodyText: null, valid: false }
  }

  const bodyBuffer = await readBoundedBody(request, MAX_ACTIVITY_JSON_BYTES)
  if (!bodyBuffer) return { bodyText: null, valid: false, tooLarge: true }
  if (verifyContentDigest(contentDigestHeader, bodyBuffer) !== 'match') {
    return { bodyText: null, valid: false }
  }

  return { bodyText: bodyBuffer.toString('utf8'), valid: true }
}

type InboundSignature =
  | {
      scheme: 'cavage'
      keyId: string
      signatureParts: Record<string, string>
      signedHeaders: string[]
    }
  | {
      scheme: 'rfc9421'
      keyId: string
      parsed: ParsedHttpMessageSignature
      // Rebuilt from our own view of the request (trusted host, https), never
      // from what the sender claims it signed.
      targetUri: string
    }

type SignatureCheck =
  | { ok: true; signature: InboundSignature }
  | { ok: false; reason: string; extra?: RejectionAttributes }

// Span attributes that tell the two schemes apart. Draft-cavage rejections
// carry none, so their trace shape is unchanged.
const getSignatureSchemeAttributes = (
  scheme: InboundSignature['scheme']
): RejectionAttributes =>
  scheme === 'rfc9421' ? { signature_scheme: 'rfc9421' } : {}

const checkCavageSignature = async (
  request: NextRequest,
  requestSignature: string
): Promise<SignatureCheck> => {
  const signatureParts = await parse(requestSignature)
  if (!signatureParts.keyId) {
    return { ok: false, reason: 'unparseable_signature' }
  }
  const signedHeaders = getSignedHeaders(signatureParts)

  if (!hasRequiredSignedHeaders(signedHeaders, request.method)) {
    return {
      ok: false,
      reason: 'missing_signed_headers',
      extra: { signed_headers: signedHeaders }
    }
  }

  if (!isSignatureFresh(request.headers, signatureParts, signedHeaders)) {
    const dateHeader = getHeadersValue(request.headers, 'date')
    const rawDate =
      typeof dateHeader === 'string'
        ? dateHeader
        : Array.isArray(dateHeader)
          ? dateHeader.join(', ')
          : undefined

    return {
      ok: false,
      reason: 'stale_date',
      extra: {
        date_header: rawDate,
        created_param: signatureParts.created,
        server_time: new Date().toISOString()
      }
    }
  }

  return {
    ok: true,
    signature: {
      scheme: 'cavage',
      keyId: signatureParts.keyId,
      signatureParts,
      signedHeaders
    }
  }
}

const checkRfc9421Signature = (
  request: NextRequest,
  targetUri: string
): SignatureCheck => {
  const schemeAttributes = getSignatureSchemeAttributes('rfc9421')
  const parsed = parseHttpMessageSignature(request.headers)
  if (!parsed) {
    return {
      ok: false,
      reason: 'unparseable_signature',
      extra: schemeAttributes
    }
  }

  if (
    !hasRequiredHttpMessageSignatureComponents(
      parsed.components,
      request.method,
      targetUri
    )
  ) {
    return {
      ok: false,
      reason: 'missing_signed_headers',
      extra: { ...schemeAttributes, signed_headers: parsed.components }
    }
  }

  if (
    parsed.createdSec === null ||
    !isWithinSignatureWindow(
      parsed.createdSec * 1000,
      parsed.expiresSec === null ? null : parsed.expiresSec * 1000
    )
  ) {
    return {
      ok: false,
      reason: 'stale_date',
      extra: {
        ...schemeAttributes,
        created_param:
          parsed.createdSec === null ? undefined : String(parsed.createdSec),
        server_time: new Date().toISOString()
      }
    }
  }

  return {
    ok: true,
    signature: { scheme: 'rfc9421', keyId: parsed.keyId, parsed, targetUri }
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

    // The request's own view of where it was sent: the trusted host and
    // always https, as every local URL is.
    const host = headerHost(request.headers)
    const requestUrl = new URL(request.url, `http://${host}`)
    // Normalised like @authority: lowercased, default port 443 dropped.
    const authority = new URL(`https://${host}`).host

    // A Signature-Input header marks an RFC 9421 HTTP Message Signature;
    // anything else is draft-cavage, checked exactly as before.
    const signatureCheck = request.headers.has('signature-input')
      ? checkRfc9421Signature(
          request,
          `https://${authority}${requestUrl.pathname}${requestUrl.search}`
        )
      : await checkCavageSignature(request, requestSignature)
    if (!signatureCheck.ok) {
      return rejectRequest(
        request,
        401,
        allowedMethods,
        signatureCheck.reason,
        signatureCheck.extra
      )
    }
    const { signature } = signatureCheck
    const schemeAttributes = getSignatureSchemeAttributes(signature.scheme)

    const digestResult =
      signature.scheme === 'rfc9421'
        ? await contentDigestMatches(request, signature.parsed.components)
        : await digestMatches(request, signature.signedHeaders)
    if (digestResult.tooLarge) {
      return rejectRequest(
        request,
        413,
        allowedMethods,
        'payload_too_large',
        schemeAttributes
      )
    }
    if (!digestResult.valid) {
      return rejectRequest(
        request,
        401,
        allowedMethods,
        'digest_mismatch',
        schemeAttributes
      )
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
        keyId: signature.keyId
      })
      return rejectRequest(
        request,
        401,
        allowedMethods,
        'invalid_activity_body',
        {
          error: activity.error,
          key_id: signature.keyId,
          ...schemeAttributes,
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
              ...schemeAttributes,
              ...getActivityTraceAttributes(activity.body)
            })
            return guardErrorResponse(request, 202, allowedMethods)
          }
        }
      }
    }

    if (!(await canFederateWithDomain(database, signature.keyId))) {
      return rejectRequest(
        request,
        403,
        allowedMethods,
        'domain_not_federatable',
        {
          key_id: signature.keyId,
          ...schemeAttributes,
          ...getActivityTraceAttributes(activity.body)
        }
      )
    }

    const requestTarget = `${request.method.toLowerCase()} ${requestUrl.pathname}${requestUrl.search}`
    const verifyWithKey = async (publicKey: string) => {
      if (signature.scheme === 'cavage') {
        return verify(requestTarget, request.headers, publicKey)
      }
      if (!publicKey) return false
      return verifyHttpMessageSignature(
        signature.parsed,
        {
          method: request.method,
          targetUri: signature.targetUri,
          headers: request.headers
        },
        publicKey
      )
    }
    const storedSenderPublicKey = await getSenderPublicKeyDetails(
      database,
      signature.keyId
    )
    let senderPublicKey = storedSenderPublicKey
    let isSignatureVerified = await verifyWithKey(senderPublicKey.publicKey)
    if (!isSignatureVerified && storedSenderPublicKey.publicKey) {
      // The sender may have rotated its key. One throttled re-fetch; the
      // stored key is only replaced once this very request verifies with the
      // fresh one, so a forged request cannot plant a key.
      const refreshed = await refreshSenderPublicKeyDetails(
        database,
        signature.keyId,
        storedSenderPublicKey
      )
      if (refreshed && (await verifyWithKey(refreshed.publicKey))) {
        isSignatureVerified = true
        senderPublicKey = refreshed
        // Only the actor's default key replaces the stored one: a request
        // signed with another key of a multi-key actor is accepted, but
        // persisting it would leave the row without the default key.
        if (refreshed.isDefaultKey) {
          try {
            await persistRefreshedSenderPublicKey(database, refreshed)
          } catch (error) {
            // The request already verified; a failed write only means the
            // next one refreshes again.
            logger.error({
              err: toLoggableError(error),
              keyId: signature.keyId,
              message: 'Unable to persist refreshed sender public key'
            })
          }
        }
      }
    }
    if (!isSignatureVerified) {
      const reason = storedSenderPublicKey.publicKey
        ? 'signature_invalid'
        : 'key_unavailable'
      return rejectRequest(request, 401, allowedMethods, reason, {
        key_id: signature.keyId,
        ...schemeAttributes,
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
          key_id: signature.keyId,
          ...schemeAttributes,
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
