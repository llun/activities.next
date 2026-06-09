import { NextRequest } from 'next/server'

import { getBaseURL } from '@/lib/config'

import { isTrustedHeaderHost } from './headerHost'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const getOrigin = (value: string | null): string | null => {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

const isAllowedOrigin = (value: string | null, baseOrigin: string): boolean => {
  const origin = getOrigin(value)
  if (!origin) return false
  if (origin === baseOrigin) return true

  const originUrl = new URL(origin)
  const baseUrl = new URL(baseOrigin)
  return (
    originUrl.protocol === baseUrl.protocol &&
    isTrustedHeaderHost(originUrl.host)
  )
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

  const baseOrigin = new URL(getBaseURL()).origin

  const origin = req.headers.get('Origin')
  if (origin) return isAllowedOrigin(origin, baseOrigin)

  const referer = req.headers.get('Referer')
  if (referer) return isAllowedOrigin(referer, baseOrigin)

  return false
}
