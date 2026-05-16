let cachedTrustProxyIpHeadersConfig: boolean | null = null

export const getTrustProxyIpHeadersConfig = (): boolean => {
  if (cachedTrustProxyIpHeadersConfig !== null) {
    return cachedTrustProxyIpHeadersConfig
  }

  cachedTrustProxyIpHeadersConfig =
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS === 'true'
  return cachedTrustProxyIpHeadersConfig
}

export const resetTrustProxyIpHeadersConfigCacheForTests = () => {
  if (process.env.JEST_WORKER_ID === undefined) {
    throw new Error('resetTrustProxyIpHeadersConfigCacheForTests is test-only')
  }

  cachedTrustProxyIpHeadersConfig = null
}
