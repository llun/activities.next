import { NextRequest } from 'next/server'

import { getBaseURL } from '@/lib/config'
import { getKnex } from '@/lib/database'
import { getAuth } from '@/lib/services/auth/auth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  StatusCode,
  apiResponse,
  codeMap,
  defaultOptions
} from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const parseBasicClientId = (authorization: string | null): string | null => {
  if (!authorization?.startsWith('Basic ')) return null

  try {
    const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64')
      .toString('utf8')
      .split(':')[0]
    return decoded || null
  } catch {
    return null
  }
}

const getClientId = (req: NextRequest, body: URLSearchParams): string | null =>
  body.get('client_id') || parseBasicClientId(req.headers.get('authorization'))

const getTokenRequestBody = async (
  req: NextRequest
): Promise<{ bodyText: string; params: URLSearchParams | null }> => {
  const bodyText = await req.text()
  const contentType = req.headers.get('content-type') ?? ''

  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return { bodyText, params: null }
  }

  return { bodyText, params: new URLSearchParams(bodyText) }
}

const validatePkceTokenExchange = async (
  req: NextRequest,
  body: URLSearchParams
): Promise<Response | null> => {
  if (body.get('grant_type') !== 'authorization_code') return null
  if (body.get('code_verifier')) return null

  const clientId = getClientId(req, body)
  if (!clientId) return null

  try {
    const client = await getKnex()('oauthClient')
      .where('clientId', clientId)
      .first()
    if (!client?.requirePKCE) return null
  } catch (e) {
    logger.error({ message: 'PKCE token preflight failed', error: e })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: codeMap[500],
      responseStatusCode: 500
    })
  }

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      error: 'invalid_request',
      error_description: 'PKCE is required for this client'
    },
    responseStatusCode: 400
  })
}

export const POST = async (req: NextRequest) => {
  const auth = getAuth()
  const { bodyText, params } = await getTokenRequestBody(req)

  if (params) {
    const pkceError = await validatePkceTokenExchange(req, params)
    if (pkceError) return pkceError
  }

  // Rewrite the URL to better-auth's token endpoint
  const url = new URL('/api/auth/oauth2/token', getBaseURL())
  const proxyReq = new Request(url.toString(), {
    method: 'POST',
    headers: req.headers,
    body: bodyText
  })

  let response: Response
  try {
    response = await auth.handler(proxyReq)
  } catch (e) {
    logger.error({ message: 'Token endpoint handler threw', error: e })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: codeMap[500],
      responseStatusCode: 500
    })
  }

  let data: Record<string, unknown> = {}
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      data = (await response.json()) as Record<string, unknown>
    } catch {
      // Non-parseable body; data remains empty
    }
  }

  const statusCode = (
    response.status in codeMap
      ? response.status
      : response.status >= 500
        ? 500
        : 400
  ) as StatusCode

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: response.ok
      ? { ...data, created_at: Math.floor(Date.now() / 1000) }
      : data,
    responseStatusCode: statusCode
  })
}
