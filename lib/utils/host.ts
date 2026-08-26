import { ACTIVITIES_HOST, FORWARDED_HOST } from '@/lib/constants'
import { getHeaderValue } from '@/lib/utils/getHeaderValue'

type NormalizeHostOptions = {
  allowWildcard?: boolean
}

export type HostRuleConfig = {
  host?: string | null
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

const getAuthority = (value: string): string => {
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  return withoutScheme.split(/[/?#]/)[0]
}

const hasOnlyAuthority = (value: string) => {
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  return !/[@/?#]/.test(withoutScheme)
}

const getExplicitPort = (value: string): string => {
  const authority = getAuthority(value)
  const bracketedPort = authority.match(/^\[[^\]]+\]:(\d+)$/)
  if (bracketedPort) return bracketedPort[1]

  if (authority.startsWith('[') || authority.split(':').length > 2) return ''

  const port = authority.match(/^[^:]+:(\d+)$/)
  return port ? port[1] : ''
}

const isSocketStyleHost = (value: string) =>
  value.startsWith('/') ||
  /^[a-z][a-z0-9+.-]*:(?!\/\/|\d+$)/i.test(value) ||
  /^[a-z]:\\/i.test(value)

const isLocalHostname = (hostname: string) => {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname === '::1' ||
    normalizedHostname === '0:0:0:0:0:0:0:1' ||
    normalizedHostname === '127.0.0.1' ||
    normalizedHostname.startsWith('127.')
  )
}

export const normalizeHost = (
  value: string | undefined | null,
  { allowWildcard = true }: NormalizeHostOptions = {}
): string | null => {
  const firstHost = value?.split(',')[0]?.trim()
  if (!firstHost || firstHost.startsWith('0.0.0.0')) return null
  // The wildcard marker sits on the AUTHORITY, which an operator may write
  // behind a scheme. Reading it off the raw value missed
  // `https://*.edge.example.com`, which used to work only by accident: it fell
  // through as a literal hostname that `getHostParts` then re-read as a
  // wildcard. The `*` refusal below closes that accident, so the marker has to
  // be recognised properly here or a scheme-prefixed wildcard rule stops
  // matching its own subdomains.
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(firstHost)?.[0] ?? ''
  const authority = firstHost.slice(scheme.length)
  const hasWildcard = authority.startsWith('*.')
  if (hasWildcard && !allowWildcard) return null
  const hostToParse = hasWildcard ? `${scheme}${authority.slice(2)}` : firstHost
  if (!hasOnlyAuthority(hostToParse)) return null
  if (isSocketStyleHost(hostToParse)) return null

  const explicitPort = getExplicitPort(hostToParse)

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(hostToParse)
        ? hostToParse
        : `https://${hostToParse}`
    )
    const hostname = url.hostname.replace(/\.$/, '')
    if (isLocalHostname(hostname)) return null
    // `hasWildcard` recognises only the documented `*.example.com` form, so
    // every other spelling — `*example.com` (a plausible typo of it), `cdn.*`,
    // `foo.*.example.com` — survives as a LITERAL hostname carrying a `*`,
    // which `hostMatchesRule` then compares literally. `new URL()` percent
    // decodes `%2a` in an authority, so a caller can spell that authority
    // exactly and be believed. A misplaced wildcard is an operator typo rather
    // than a host, so refusing it leaves the rule matching nothing instead of
    // matching one attacker-chosen authority. Nothing legitimate reaches this
    // line with a `*` — the documented form has already had its prefix
    // stripped off `hostToParse`.
    //
    // Note the rule is dropped SILENTLY HERE: `normalizeHostRules` flat-maps
    // the null away, and this is a per-request path behind a cache, so it is
    // the wrong place to log from. `buildTrustedOrigins` is the one consumer
    // that does warn about a misplaced wildcard, so that is where an operator
    // sees the typo.
    if (hostname.includes('*')) return null

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
  const normalizedHost = normalizeHost(host, { allowWildcard: false })
  if (!normalizedHost) return false

  return normalizeHostRules(rules).some((rule) =>
    hostMatchesRule(normalizedHost, rule)
  )
}

/**
 * Reduces a host value to a comparable authority: no scheme, no path, lower
 * case, and without either default port. Configured hosts are documented as
 * bare authorities, but an operator may still write `https://example.com/` or
 * `example.com:443`, while `new URL(...).host` has already dropped the port its
 * own scheme implies.
 *
 * Dropping BOTH ports is deliberate rather than scheme-aware: the value may be
 * a bare authority carrying no scheme to consult, and the only authority a
 * blanket strip can newly equate is our own hostname on the other default port
 * — a host this instance answers to either way. It does mean the exact pass
 * accepts `example.com:80` where `hostMatchesRule` (which treats only `:443`
 * as implied) would not; the passes are a union, and this is the half that
 * decides.
 */
const canonicalAuthority = (value: string | undefined | null): string => {
  if (!value) return ''
  return getAuthority(value.trim())
    .toLowerCase()
    .replace(/:(?:80|443)$/, '')
}

/**
 * Whether an authority — a `host` or `host:port`, the shape `new URL(...).host`
 * reports — is one this instance serves: the configured host, or any
 * `ACTIVITIES_TRUSTED_HOSTS` entry. Use it to decide whether a stored absolute
 * URL points back at us.
 *
 * `isHostTrustedByRules` alone is not that question. It answers the narrower
 * one — may an inbound `X-Forwarded-Host` be believed — and `normalizeHost`
 * deliberately rejects loopback names for it, so on a `localhost:3000`
 * development instance it says no to the instance's own host. Comparing
 * canonical authorities first covers that case and every exact `host:port`
 * match; deferring to the rules matcher after it adds the wildcard entries
 * (`*.example.com`) that only that matcher understands. The exact pass skips
 * wildcard rules for that reason: compared literally, `*.example.com` would
 * match a URL whose authority is spelled exactly that.
 */
export const isOwnInstanceHost = (
  host: string | undefined | null,
  config: HostRuleConfig
): boolean => {
  const authority = canonicalAuthority(host)
  if (!authority) return false

  const rules = getTrustedHostRules(config)
  // A wildcard entry is never a literal authority. `new URL()` accepts `*` in
  // a host, so comparing `*.cdn.example` against itself would let a URL
  // spelling that authority pass as one of ours — the hole
  // `scripts/maintenance/backfillMediaBlurhash.ts` documents closing for its
  // own matcher. Wildcards belong to the rules pass below, which expands them.
  //
  // This pass reads the RAW rules, so it needs its own skip: `normalizeHost`
  // refusing a misplaced `*` covers the rules pass, not this one.
  if (
    rules.some(
      (rule) => !rule.includes('*') && canonicalAuthority(rule) === authority
    )
  ) {
    return true
  }

  return isHostTrustedByRules(host, rules)
}

export const selectHeaderHost = (
  headers: HostHeaders,
  config: HostRuleConfig
): string => {
  const configuredHost = getConfiguredHost(config.host)

  for (const headerName of [ACTIVITIES_HOST, FORWARDED_HOST, 'host']) {
    const headerHost = getHeaderValue(headers, headerName)
    if (!headerHost) continue

    const normalizedHost = normalizeHost(headerHost, { allowWildcard: false })
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
