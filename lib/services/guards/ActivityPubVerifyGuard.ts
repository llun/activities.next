import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { getDatabase } from '@/lib/database'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getHeadersValue } from '@/lib/services/guards/getHeaderValue'
import { extractActivityPubId, normalizeActorId } from '@/lib/utils/activitypub'
import { HttpMethod } from '@/lib/utils/http-headers'
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
import { ActivityPubVerifiedSenderHandle, AppRouterParams } from './types'

const SIGNATURE_CLOCK_SKEW_MS = 5 * 60 * 1000

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

const getSignedHeaders = (signatureParts: Record<string, string>) =>
  (signatureParts.headers ?? '').toLowerCase().split(/\s+/).filter(Boolean)

const REQUIRED_MUTATING_SIGNED_HEADERS = [
  '(request-target)',
  'host',
  'date',
  'digest'
]

const isMutatingRequest = (method: string) =>
  !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())

const hasRequiredMutatingSignedHeaders = (signedHeaders: string[]) =>
  REQUIRED_MUTATING_SIGNED_HEADERS.every((header) =>
    signedHeaders.includes(header)
  )

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

const getPostActivity = ({
  bodyText,
  method
}: {
  bodyText: string | null
  method: string
}) => {
  if (method.toUpperCase() !== 'POST') {
    return { actor: null, body: null, valid: true }
  }

  try {
    if (bodyText === null) return { actor: null, body: null, valid: false }

    const body = JSON.parse(bodyText) as unknown
    if (!isRecord(body)) {
      return { actor: null, body: null, valid: false }
    }

    const actor = extractActivityPubId(body.actor)
    if (!actor || !normalizeActorId(actor)) {
      return { actor: null, body: null, valid: false }
    }

    return { actor, body: { ...body, actor }, valid: true }
  } catch {
    return { actor: null, body: null, valid: false }
  }
}

const isDateHeaderFresh = (
  headers: Headers,
  signedHeaders: string[],
  now = Date.now()
) => {
  if (!signedHeaders.includes('date')) return false

  const dateHeader = getHeadersValue(headers, 'date')
  if (!dateHeader || Array.isArray(dateHeader)) return false

  const signedAt = Date.parse(dateHeader)
  if (Number.isNaN(signedAt)) return false

  return Math.abs(now - signedAt) <= SIGNATURE_CLOCK_SKEW_MS
}

const hasHostHeader = (headers: Headers) => {
  const host = getHeadersValue(headers, 'host')
  return typeof host === 'string' && host.trim().length > 0
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

    const requestSignature = request.headers.get('signature')
    if (!requestSignature)
      return guardErrorResponse(request, 400, allowedMethods)

    const signatureParts = await parse(requestSignature)
    if (!signatureParts.keyId) {
      return guardErrorResponse(request, 400, allowedMethods)
    }
    const signedHeaders = getSignedHeaders(signatureParts)
    const requiresMutatingSignature = isMutatingRequest(request.method)

    if (
      requiresMutatingSignature &&
      (!hasHostHeader(request.headers) ||
        !hasRequiredMutatingSignedHeaders(signedHeaders))
    ) {
      return guardErrorResponse(request, 400, allowedMethods)
    }

    if (!isDateHeaderFresh(request.headers, signedHeaders)) {
      return guardErrorResponse(request, 400, allowedMethods)
    }

    const digestResult = await digestMatches(request, signedHeaders)
    if (!digestResult.valid) {
      return guardErrorResponse(request, 400, allowedMethods)
    }

    const activity = getPostActivity({
      bodyText: digestResult.bodyText,
      method: request.method
    })
    if (!activity.valid) {
      return guardErrorResponse(request, 400, allowedMethods)
    }

    if (!(await canFederateWithDomain(database, signatureParts.keyId))) {
      return guardErrorResponse(request, 403, allowedMethods)
    }

    const host = headerHost(request.headers)
    const requestUrl = new URL(request.url, `http://${host}`)
    const requestTarget = `${request.method.toLowerCase()} ${requestUrl.pathname}${requestUrl.search}`
    const senderPublicKey = await getSenderPublicKeyDetails(
      database,
      signatureParts.keyId
    )
    if (
      !(await verify(requestTarget, request.headers, senderPublicKey.publicKey))
    ) {
      return guardErrorResponse(request, 400, allowedMethods)
    }

    const verifiedSenderActorId = normalizeActorId(senderPublicKey.owner)
    if (!verifiedSenderActorId) {
      return guardErrorResponse(request, 400, allowedMethods)
    }

    if (activity.actor) {
      const normalizedActor = normalizeActorId(activity.actor)

      if (verifiedSenderActorId !== normalizedActor) {
        return guardErrorResponse(request, 403, allowedMethods)
      }
    }

    return handle(request, {
      activityBody: activity.body,
      database,
      params: context.params,
      verifiedSenderActorId
    })
  }
