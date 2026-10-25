import crypto from 'crypto'

import { getConfig } from '@/lib/config'
import type {
  DomainCheckItem,
  DomainCheckResult
} from '@/lib/database/domains/servedDomain/types'
import { getHeaderValue } from '@/lib/utils/getHeaderValue'
import {
  HOST_HEADER_NAMES,
  type HostHeaders,
  getServedAuthority
} from '@/lib/utils/host'
import {
  type SafeRemoteFetchOptions,
  type SafeRemoteFetchResult,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

/**
 * "Does this domain reach THIS server?" for Admin › Served domains.
 *
 * The admin page asks `https://<domain>/.well-known/activities-domain-check`
 * with a fresh random nonce. The route answers with an HMAC of the nonce and
 * the host the request arrived with, keyed by a key derived from the server's
 * secret, so only this server (any of its instances) can produce it, and only
 * when the proxy in front of it kept the domain in the Host header.
 *
 * The key is derived from `ACTIVITIES_SECRET_PHASE` with its own label, so the
 * public route is not a general HMAC oracle over the secret: anything it signs
 * is only ever a domain-check proof.
 */

export const DOMAIN_CHECK_PATH = '/.well-known/activities-domain-check'
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const KEY_LABEL = 'activities.next domain check v1'
const MAX_BODY_BYTES = 16 * 1024

export const isDomainCheckNonce = (value: string | null | undefined) =>
  typeof value === 'string' && NONCE_PATTERN.test(value)

const getDomainCheckKey = (secret: string) =>
  crypto.createHmac('sha256', secret).update(KEY_LABEL).digest()

export const getDomainCheckProof = (
  nonce: string,
  host: string,
  secret: string = getConfig().secretPhase
): string =>
  crypto
    .createHmac('sha256', getDomainCheckKey(secret))
    .update(`${nonce}\n${host}`)
    .digest('base64url')

/**
 * The host a request arrived with, in the order `selectHeaderHost` reads the
 * headers but WITHOUT its trust filter: the domain being checked is not
 * trusted yet. Normalised for comparison; never echoed back.
 */
export const getDomainCheckRequestHost = (headers: HostHeaders): string => {
  for (const name of HOST_HEADER_NAMES) {
    const value = getHeaderValue(headers, name)?.split(',')[0]?.trim()
    if (!value) continue
    return getServedAuthority(value) ?? ''
  }
  return ''
}

type DomainCheckFetch = (
  options: SafeRemoteFetchOptions
) => Promise<SafeRemoteFetchResult>

export type CheckDomainParams = {
  domain: string
  // The env domains: a proof for one of them means the proxy forwarded the
  // request but put another Host on it.
  knownHosts?: readonly string[]
  fetch?: DomainCheckFetch
  secret?: string
}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'ESERVFAIL'])
const PRIVATE_ADDRESS_CODES = new Set(['ERR_UNSAFE_REMOTE_URL'])

const isTlsError = (code: string, message: string) =>
  /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|EPROTO/i.test(
    code
  ) || /certificate|ssl|tls/i.test(message)

const items = (
  dns: DomainCheckItem['status'],
  tls: DomainCheckItem['status'],
  host: DomainCheckItem['status']
): DomainCheckItem[] => [
  { key: 'dns', status: dns },
  { key: 'tls', status: tls },
  { key: 'host', status: host }
]

const readErrorCode = (error: unknown): { code: string; message: string } => {
  if (!error || typeof error !== 'object') {
    return { code: '', message: String(error) }
  }
  const record = error as { code?: unknown; message?: unknown; cause?: unknown }
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''
  if (!code && record.cause) return readErrorCode(record.cause)
  return { code, message }
}

const readProof = (body: string): string | null => {
  try {
    const parsed = JSON.parse(body) as { proof?: unknown }
    return typeof parsed?.proof === 'string' ? parsed.proof : null
  } catch {
    return null
  }
}

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/** Runs the reachability check for an already-normalised domain. */
export const checkDomainReachability = async ({
  domain,
  knownHosts = [],
  fetch = safeRemoteFetch,
  secret = getConfig().secretPhase
}: CheckDomainParams): Promise<DomainCheckResult> => {
  const nonce = crypto.randomBytes(32).toString('base64url')
  const url = `https://${domain}${DOMAIN_CHECK_PATH}?nonce=${nonce}`

  let response: SafeRemoteFetchResult
  try {
    response = await fetch({
      url,
      method: 'GET',
      headers: { Accept: 'application/json' },
      allowCrossHostRedirects: false,
      maxRedirects: 0,
      maxBodyBytes: MAX_BODY_BYTES,
      onBodyTooLarge: 'fail',
      connectTimeoutInMilliseconds: 5_000,
      readTimeoutInMilliseconds: 5_000,
      timeoutInMilliseconds: 10_000
    })
  } catch (error) {
    const { code, message } = readErrorCode(error)
    if (DNS_CODES.has(code) || /Unable to resolve remote host/.test(message)) {
      return {
        passed: false,
        reason: 'dns',
        items: items('failed', 'skipped', 'skipped')
      }
    }
    if (PRIVATE_ADDRESS_CODES.has(code)) {
      return {
        passed: false,
        reason: 'private-address',
        items: items('failed', 'skipped', 'skipped')
      }
    }
    if (isTlsError(code, message)) {
      return {
        passed: false,
        reason: 'tls',
        items: items('passed', 'failed', 'skipped')
      }
    }
    return {
      passed: false,
      reason: 'unreachable',
      items: items('passed', 'skipped', 'skipped')
    }
  }

  const proof =
    response.statusCode === 200 ? readProof(response.body) : (null as null)
  const expectedHost = getServedAuthority(domain) ?? domain
  if (
    proof &&
    safeEqual(proof, getDomainCheckProof(nonce, expectedHost, secret))
  ) {
    return {
      passed: true,
      reason: 'passed',
      items: items('passed', 'passed', 'passed')
    }
  }

  const reachedThisServer =
    proof !== null &&
    knownHosts.some((host) => {
      const authority = getServedAuthority(host)
      return (
        authority !== null &&
        safeEqual(proof, getDomainCheckProof(nonce, authority, secret))
      )
    })
  return {
    passed: false,
    reason: reachedThisServer ? 'host-header' : 'other-server',
    items: items('passed', 'passed', 'failed')
  }
}
