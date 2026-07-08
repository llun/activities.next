import { SignJWT, importPKCS8 } from 'jose'
import { NextRequest } from 'next/server'

import { buildBaseURL } from '@/lib/config'
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

// The body carries a signed, time-limited credential and this endpoint is
// anonymous + CORS-enabled, so no intermediary (this app is commonly deployed
// behind CloudFront) may store and replay the response. `dynamic` only pins
// Next's rendering strategy; the header is what a CDN honours.
const NO_STORE_HEADERS: [string, string][] = [['Cache-Control', 'no-store']]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Importing an EC private key is not free; the key only changes when the
// deployment config changes (or a test swaps it), so cache the imported
// CryptoKey keyed on the PEM string.
let cachedPrivateKeyPem: string | null = null
let cachedPrivateKey: CryptoKey | null = null

const importPrivateKey = async (privateKey: string): Promise<CryptoKey> => {
  if (cachedPrivateKey && cachedPrivateKeyPem === privateKey) {
    return cachedPrivateKey
  }
  const key = await importPKCS8(privateKey, 'ES256')
  cachedPrivateKeyPem = privateKey
  cachedPrivateKey = key
  return key
}

/**
 * Comma separated list of origins the minted token is valid for.
 *
 * The endpoint is intentionally anonymous (public embeds and shared heatmap
 * pages render maps for logged-out visitors), so binding the token to this
 * instance's own origins is what bounds abuse of a leaked token.
 *
 * MapKit compares this claim against the browser's `Origin` header, so the
 * scheme has to match how the app is actually served. `buildBaseURL` applies the
 * configured auth scheme (`http` only under the local-dev-only
 * `ACTIVITIES_INSECURE_AUTH`, `https` everywhere else) and leaves hosts that
 * already carry a scheme untouched.
 */
const getAllowedOrigins = (): string => {
  const { host, trustedHosts } = getProxyHostConfig()
  const origins = [host, ...trustedHosts]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => buildBaseURL(value))
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
      const key = await importPrivateKey(mapProvider.privateKey)
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
        data: { token, expiresAt: Date.now() + TOKEN_TTL_MS },
        additionalHeaders: NO_STORE_HEADERS
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
