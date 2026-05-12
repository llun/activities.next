import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { getDatabase } from '@/lib/database'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getHeadersValue } from '@/lib/services/guards/getHeaderValue'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  StatusCode,
  apiErrorResponse,
  apiResponse,
  codeMap
} from '@/lib/utils/response'
import { parse, verify } from '@/lib/utils/signature'

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getPostActivityActor = async (request: NextRequest) => {
  if (request.method.toUpperCase() !== 'POST') {
    return { actor: null, valid: true }
  }

  try {
    const body = (await request.clone().json()) as unknown
    if (!isRecord(body) || typeof body.actor !== 'string') {
      return { actor: null, valid: false }
    }

    return { actor: body.actor, valid: true }
  } catch {
    return { actor: null, valid: false }
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

const digestMatches = async (request: NextRequest, signedHeaders: string[]) => {
  const digestHeader = getHeadersValue(request.headers, 'digest')
  if (!digestHeader)
    return ['GET', 'HEAD'].includes(request.method.toUpperCase())
  if (Array.isArray(digestHeader)) return false
  if (!signedHeaders.includes('digest')) return false

  const expectedDigest = getExpectedSha256Digest(digestHeader)
  if (!expectedDigest) return false

  const bodyBuffer = Buffer.from(await request.clone().arrayBuffer())
  const actualDigest = crypto
    .createHash('sha256')
    .update(bodyBuffer)
    .digest('base64')

  const actualDigestBuffer = Buffer.from(actualDigest, 'base64')
  const expectedDigestBuffer = Buffer.from(expectedDigest, 'base64')

  if (actualDigestBuffer.length !== expectedDigestBuffer.length) return false

  return crypto.timingSafeEqual(actualDigestBuffer, expectedDigestBuffer)
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

    if (!isDateHeaderFresh(request.headers, signedHeaders)) {
      return guardErrorResponse(request, 400, allowedMethods)
    }

    if (!(await digestMatches(request, signedHeaders))) {
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

    const activityActor = await getPostActivityActor(request)
    if (!activityActor.valid) {
      return guardErrorResponse(request, 400, allowedMethods)
    }

    if (activityActor.actor && senderPublicKey.owner !== activityActor.actor) {
      return guardErrorResponse(request, 403, allowedMethods)
    }

    return handle(request, { database, params: context.params })
  }
