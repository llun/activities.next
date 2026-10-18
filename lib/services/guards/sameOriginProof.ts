import { NextRequest } from 'next/server'

import { getBaseURL } from '@/lib/config'
import { logger } from '@/lib/utils/logger'

import { isTrustedHeaderHost } from './headerHost'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const isAllowedOrigin = (value: string, baseUrl: URL): boolean => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.origin === baseUrl.origin) return true
  return url.protocol === baseUrl.protocol && isTrustedHeaderHost(url.host)
}

const evaluateSameOriginProof = (req: NextRequest) => {
  const baseUrl = new URL(getBaseURL())

  const origin = req.headers.get('Origin')
  const referer = req.headers.get('Referer')
  const allowed = origin
    ? isAllowedOrigin(origin, baseUrl)
    : Boolean(referer && isAllowedOrigin(referer, baseUrl))

  return { allowed, origin, referer, baseOrigin: baseUrl.origin }
}

/**
 * CSRF defense for cookie-session authenticated mutations: state-changing
 * requests must carry an Origin (or Referer) header that resolves to the
 * configured base origin or a trusted host. Browsers always send Origin on
 * cross-site and same-origin POST/PUT/PATCH/DELETE, so legitimate same-origin
 * requests pass while cross-site requests (and header-less forged requests)
 * are rejected.
 */
export const hasSameOriginProof = (req: NextRequest): boolean => {
  if (!STATE_CHANGING_METHODS.has(req.method)) return true

  const { allowed, origin, referer, baseOrigin } = evaluateSameOriginProof(req)

  if (!allowed) {
    // Surface rejections so a misconfigured host or missing trusted-host
    // entry is diagnosable instead of presenting as a silent 403.
    logger.warn({
      message: 'Rejected state-changing request without same-origin proof',
      method: req.method,
      origin,
      referer,
      baseOrigin
    })
  }
  return allowed
}

/**
 * The same check as `hasSameOriginProof` without the rejection warning, for
 * an unauthenticated, high-volume endpoint (browser telemetry) where anyone
 * can send forged requests and a warning per rejection would flood the logs.
 */
export const hasSameOriginProofQuietly = (req: NextRequest): boolean =>
  !STATE_CHANGING_METHODS.has(req.method) ||
  evaluateSameOriginProof(req).allowed
