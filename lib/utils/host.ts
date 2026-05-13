import { ACTIVITIES_HOST, FORWARDED_HOST } from '@/lib/constants'

type HostRuleConfig = {
  host?: string | null
  allowActorDomains?: readonly string[] | null
  trustedHosts?: readonly string[] | null
}

export type HostHeaders =
  | Headers
  | Record<string, string | string[] | undefined | null>
  | undefined
  | null

const MAX_HOST_CACHE_ENTRIES = 1024
const MAX_HOST_RULES_CACHE_ENTRIES = 256

const normalizedRulesCache = new Map<string, string[]>()
const DEFAULT_HTTPS_PORT = '443'

type HostParts = {
  hasWildcard: boolean
  hostname: string
  port: string
}

const hostPartsCache = new Map<string, HostParts>()

const setBoundedCacheValue = <T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  maxEntries: number
) => {
  if (cache.has(key)) {
    cache.delete(key)
  } else if (cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }

  cache.set(key, value)
}

const getExplicitPort = (value: string): string => {
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const authority = withoutScheme.split(/[/?#]/)[0]
  const bracketedPort = authority.match(/^\[[^\]]+\]:(\d+)$/)
  if (bracketedPort) return bracketedPort[1]

  const port = authority.match(/:(\d+)$/)
  return port ? port[1] : ''
}

export const normalizeHost = (
  value: string | undefined | null
): string | null => {
  const firstHost = value?.split(',')[0]?.trim()
  if (!firstHost || firstHost.startsWith('0.0.0.0')) return null
  const hasWildcard = firstHost.startsWith('*.')
  const hostToParse = hasWildcard ? firstHost.slice(2) : firstHost
  const explicitPort = getExplicitPort(hostToParse)

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(hostToParse)
        ? hostToParse
        : `https://${hostToParse}`
    )
    const hostname = url.hostname.replace(/\.$/, '')
    const normalizedHost = explicitPort
      ? `${hostname}:${explicitPort}`
      : hostname
    return hasWildcard ? `*.${normalizedHost}` : normalizedHost
  } catch {
    return null
  }
}

const getHostParts = (normalizedHost: string) => {
  const cachedParts = hostPartsCache.get(normalizedHost)
  if (cachedParts) return cachedParts

  const hasWildcard = normalizedHost.startsWith('*.')
  const hostToParse = hasWildcard ? normalizedHost.slice(2) : normalizedHost
  const url = new URL(`https://${hostToParse}`)
  const explicitPort = getExplicitPort(hostToParse)

  const hostParts = {
    hasWildcard,
    hostname: url.hostname,
    port: explicitPort
  }
  setBoundedCacheValue(
    hostPartsCache,
    normalizedHost,
    hostParts,
    MAX_HOST_CACHE_ENTRIES
  )
  return hostParts
}

const getPortForRuleMatching = (port: string) =>
  port === DEFAULT_HTTPS_PORT ? '' : port

export const normalizeHostRules = (rules: readonly string[]) => {
  const cacheKey = JSON.stringify(rules)
  const cachedRules = normalizedRulesCache.get(cacheKey)
  if (cachedRules) return cachedRules

  const normalizedRules = rules.flatMap((rule) => {
    const normalizedRule = normalizeHost(rule)
    return normalizedRule ? [normalizedRule] : []
  })
  setBoundedCacheValue(
    normalizedRulesCache,
    cacheKey,
    normalizedRules,
    MAX_HOST_RULES_CACHE_ENTRIES
  )
  return normalizedRules
}

export const getTrustedHostRules = (config: HostRuleConfig): string[] => [
  config.host ?? '',
  ...(config.allowActorDomains ?? []),
  ...(config.trustedHosts ?? [])
]

export const getConfiguredHost = (host: string | undefined | null) =>
  normalizeHost(host) ?? host ?? ''

export const hostMatchesRule = (host: string, normalizedRule: string) => {
  if (host === normalizedRule) return true

  const hostParts = getHostParts(host)
  const ruleParts = getHostParts(normalizedRule)

  if (ruleParts.hasWildcard) {
    return (
      hostParts.hostname.endsWith(`.${ruleParts.hostname}`) &&
      getPortForRuleMatching(hostParts.port) ===
        getPortForRuleMatching(ruleParts.port)
    )
  }

  return (
    hostParts.hostname === ruleParts.hostname &&
    getPortForRuleMatching(hostParts.port) ===
      getPortForRuleMatching(ruleParts.port)
  )
}

export const isHostTrustedByRules = (
  host: string | undefined | null,
  rules: readonly string[]
) => {
  const normalizedHost = normalizeHost(host)
  if (!normalizedHost) return false

  return normalizeHostRules(rules).some((rule) =>
    hostMatchesRule(normalizedHost, rule)
  )
}

const getFirstHeaderValue = (value: string | string[] | undefined | null) => {
  if (Array.isArray(value)) return value[0]
  return value
}

const getHeaderValue = (headers: HostHeaders, name: string) => {
  if (!headers) return undefined

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name)
  }

  const normalizedName = name.toLowerCase()
  const recordHeaders = headers as Record<
    string,
    string | string[] | undefined | null
  >
  const matchingKey = Object.keys(recordHeaders).find(
    (key) => key.toLowerCase() === normalizedName
  )
  return matchingKey
    ? getFirstHeaderValue(recordHeaders[matchingKey])
    : undefined
}

export const selectHeaderHost = (
  headers: HostHeaders,
  config: HostRuleConfig
): string => {
  const configuredHost = getConfiguredHost(config.host)

  for (const headerName of [ACTIVITIES_HOST, FORWARDED_HOST, 'host']) {
    const headerHost = getHeaderValue(headers, headerName)
    if (!headerHost) continue

    const normalizedHost = normalizeHost(headerHost)
    if (!normalizedHost) continue

    return isHostTrustedByRules(normalizedHost, getTrustedHostRules(config))
      ? normalizedHost
      : configuredHost
  }

  return configuredHost
}

export const resetHostCachesForTests = () => {
  normalizedRulesCache.clear()
  hostPartsCache.clear()
}

export const getHostCacheSizesForTests = () => ({
  normalizedRules: normalizedRulesCache.size,
  hostParts: hostPartsCache.size
})
