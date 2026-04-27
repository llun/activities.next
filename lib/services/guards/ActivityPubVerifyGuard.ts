import crypto from 'crypto'
import { NextRequest } from 'next/server'

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

import { getSenderPublicKey } from './getSenderPublicKey'
import { headerHost } from './headerHost'
import { ActivityPubVerifiedSenderHandle, AppRouterParams } from './types'

const SIGNATURE_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000

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
  if (!digestHeader) return true
  if (Array.isArray(digestHeader)) return false
  if (!signedHeaders.includes('digest')) return false

  const separatorIndex = digestHeader.indexOf('=')
  if (separatorIndex === -1) return false

  const algorithm = digestHeader.slice(0, separatorIndex).toLowerCase()
  const expectedDigest = digestHeader.slice(separatorIndex + 1)
  if (algorithm !== 'sha-256') return false

  const body = await request.clone().text()
  const actualDigest = crypto.createHash('sha256').update(body).digest('base64')

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
    const publicKey = await getSenderPublicKey(database, signatureParts.keyId)
    if (
      !(await verify(
        `${request.method.toLowerCase()} ${requestUrl.pathname}`,
        request.headers,
        publicKey
      ))
    ) {
      return guardErrorResponse(request, 400, allowedMethods)
    }

    return handle(request, { database, params: context.params })
  }
