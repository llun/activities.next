let cachedTrustProxyIpHeadersConfig: boolean | null = null

export const getTrustProxyIpHeadersConfig = (): boolean => {
  if (cachedTrustProxyIpHeadersConfig !== null) {
    return cachedTrustProxyIpHeadersConfig
  }

  cachedTrustProxyIpHeadersConfig =
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS === 'true'
  return cachedTrustProxyIpHeadersConfig
}

// The one proxy header an operator may pin the client address to
// (`ACTIVITIES_TRUST_PROXY_IP_HEADER`). Unset, `getTrustedClientIp` reads its
// compatibility chain (cf-connecting-ip, x-real-ip, leftmost x-forwarded-for).
export const TRUST_PROXY_IP_HEADER_NAMES = [
  'cf-connecting-ip',
  'x-real-ip',
  'x-forwarded-for',
  'fly-client-ip',
  'true-client-ip'
] as const

export type TrustProxyIpHeaderName =
  (typeof TRUST_PROXY_IP_HEADER_NAMES)[number]

// `undefined` = not resolved yet; `null` = resolved, unset.
let cachedTrustProxyIpHeader: TrustProxyIpHeaderName | null | undefined

export const getTrustProxyIpHeaderConfig =
  (): TrustProxyIpHeaderName | null => {
    if (cachedTrustProxyIpHeader !== undefined) return cachedTrustProxyIpHeader

    const raw =
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER?.trim().toLowerCase()
    if (!raw) {
      cachedTrustProxyIpHeader = null
      return null
    }
    const name = TRUST_PROXY_IP_HEADER_NAMES.find(
      (candidate) => candidate === raw
    )
    if (!name) {
      throw new Error(
        `ACTIVITIES_TRUST_PROXY_IP_HEADER must be one of ${TRUST_PROXY_IP_HEADER_NAMES.join(', ')}`
      )
    }
    cachedTrustProxyIpHeader = name
    return name
  }

export const resetTrustProxyIpHeadersConfigCacheForTests = () => {
  if (!process.env.VITEST) {
    throw new Error('resetTrustProxyIpHeadersConfigCacheForTests is test-only')
  }

  cachedTrustProxyIpHeadersConfig = null
  cachedTrustProxyIpHeader = undefined
}
