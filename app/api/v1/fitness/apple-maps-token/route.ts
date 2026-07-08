import { SignJWT, importPKCS8 } from 'jose'
import { NextRequest } from 'next/server'

import { getProxyHostConfig } from '@/lib/config/host'
import { getMapProviderConfig } from '@/lib/config/mapProvider'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

const TOKEN_TTL_SECONDS = 30 * 60
const TOKEN_TTL_MS = TOKEN_TTL_SECONDS * 1000

export const OPTIONS = defaultOptions(CORS_HEADERS)

/**
 * Comma separated list of `https://` origins the minted token is valid for.
 *
 * The endpoint is intentionally anonymous (public embeds and shared heatmap
 * pages render maps for logged-out visitors), so binding the token to this
 * instance's own origins is what bounds abuse of a leaked token.
 */
const getAllowedOrigins = (): string => {
  const { host, trustedHosts } = getProxyHostConfig()
  const origins = [host, ...trustedHosts]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => `https://${value}`)
  return Array.from(new Set(origins)).join(',')
}

export const GET = traceApiRoute(
  'getAppleMapsToken',
  async (req: NextRequest) => {
    const mapProvider = getMapProviderConfig()
    if (mapProvider.type !== 'apple') {
      return apiCorsError(req, CORS_HEADERS, HTTP_STATUS.NOT_FOUND)
    }

    try {
      const key = await importPKCS8(mapProvider.privateKey, 'ES256')
      const token = await new SignJWT({
        origin: getAllowedOrigins(),
        scope: 'mapkit_js'
      })
        .setProtectedHeader({
          alg: 'ES256',
          kid: mapProvider.keyId,
          typ: 'JWT'
        })
        .setIssuer(mapProvider.teamId)
        .setIssuedAt()
        .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
        .sign(key)

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { token, expiresAt: Date.now() + TOKEN_TTL_MS }
      })
    } catch (error) {
      logger.error({
        message: 'Fail to sign Apple MapKit JS token',
        error: error instanceof Error ? error.message : String(error)
      })
      return apiCorsError(req, CORS_HEADERS, HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  }
)
