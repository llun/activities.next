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

/**
 * The configured host as a request should see it. NOT an authority for
 * comparing against — that is `getCanonicalAuthority`. This one falls back to
 * the RAW value whenever `normalizeHost` refuses it, which includes every
 * loopback name and every malformed one, so it can hand back something
 * unlowercased, untrimmed, or carrying a path. `selectHeaderHost` wants that
 * (it is echoing a configured value back, not deciding trust); a security
 * comparison must not use it.
 */
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
 *
 * Also the shape `getMediaFileUrl` consumes, which is why it is exported: the
 * configured host is the fallback authority a stored media URL is minted on,
 * and it has to be normalised the same way the comparison normalises it.
 */
export const getCanonicalAuthority = (
  value: string | undefined | null
): string => {
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
): boolean => isHostServedByRules(host, getTrustedHostRules(config))

/**
 * The matcher behind `isOwnInstanceHost` and `createServedDomainMatcher`: whether an
 * authority (`host` or `host:port`) is one of `rules`, a list of configured
 * host entries that may carry `*.example.com` wildcards and may be written as
 * URLs. Kept apart from `isOwnInstanceHost` so the served-domain check can
 * hand it a different rule list without a second matcher that disagrees with
 * this one. A caller that matches many hosts against one list builds the
 * matcher once with `createHostRulesMatcher`.
 */
export const isHostServedByRules = (
  host: string | undefined | null,
  rules: readonly string[]
): boolean => createHostRulesMatcher(rules)(host)

/**
 * `isHostServedByRules` with the rule list prepared once: the literal
 * authorities and the normalised rules are computed here and closed over, so a
 * fan-out loop does not rebuild them (or the rules cache key) per host.
 */
export const createHostRulesMatcher = (
  rules: readonly string[]
): ((host: string | undefined | null) => boolean) => {
  // A wildcard entry is never a literal authority. `new URL()` accepts `*` in
  // a host, so comparing `*.cdn.example` against itself would let a URL
  // spelling that authority pass as one of ours — the hole
  // `scripts/maintenance/backfillMediaBlurhash.ts` documents closing for its
  // own matcher. Wildcards belong to the rules pass below, which expands them.
  //
  // This pass reads the RAW rules, so it needs its own skip: `normalizeHost`
  // refusing a misplaced `*` covers the rules pass, not this one.
  const literalAuthorities = new Set(
    rules
      .filter((rule) => !rule.includes('*'))
      .map((rule) => getCanonicalAuthority(rule))
      .filter(Boolean)
  )
  const normalizedRules = normalizeHostRules(rules)

  return (host) => {
    const authority = getCanonicalAuthority(host)
    if (!authority) return false
    if (literalAuthorities.has(authority)) return true

    const normalizedHost = normalizeHost(host, { allowWildcard: false })
    if (!normalizedHost) return false
    return normalizedRules.some((rule) => hostMatchesRule(normalizedHost, rule))
  }
}

/**
 * The sources of "a domain this server serves" — this server's federation
 * identity: the primary host (`ACTIVITIES_HOST`) and the CONCRETE entries of
 * `ACTIVITIES_TRUSTED_HOSTS`. A wildcard trusted host (`*.vercel.app`, say)
 * exists so `X-Forwarded-Host` can be believed on preview deployments; it is
 * not a claim that every such subdomain is this server, so it is left out.
 *
 * `federation.allowActorDomains` is deliberately NOT a source. It lists the
 * domains actors may be created on and the domains exempt from federation
 * policy, and in allowlist mode the admin form presents it as "Allowed
 * servers", so it can hold remote servers; treating those as ours would stop
 * search, quotes, forwarding and emoji from reaching them. The federation
 * policy adds it to its own exemption set (`domainPolicy.ts`).
 *
 * A new source (a database-backed domain list, say) becomes one more field
 * here and one more spread in `getServedDomainRules`, so every caller picks it
 * up at once.
 */
export type ServedDomainSources = HostRuleConfig

export const getServedDomainRules = (sources: ServedDomainSources): string[] =>
  getTrustedHostRules(sources).filter((rule) => !rule.includes('*'))

/**
 * The authority a URL or a bare host names, normalised for comparison: lower
 * case, IDNA-mapped and percent-decoded by the URL parser, without a trailing
 * dot, and without a default port (`:443` or `:80`, as `getCanonicalAuthority`
 * drops both). Accepts an ActivityPub id (`https://host/users/a`), a bare
 * `host`, or `host:port`; a path, query or fragment is ignored and userinfo is
 * resolved the way a fetch would (`https://ours@evil.example` names
 * `evil.example`). Null for anything the parser refuses, a host-less URI, and
 * any authority carrying a `*`, so a wildcard rule can never be spelled as a
 * literal authority and matched against itself.
 */
export const getServedAuthority = (
  value: string | undefined | null
): string | null => {
  const trimmed = value?.trim()
  if (!trimmed) return null

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    )
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!hostname || hostname.includes('*')) return null
    const port = url.port === '443' || url.port === '80' ? '' : url.port
    return port ? `${hostname}:${port}` : hostname
  } catch {
    return null
  }
}

/**
 * A domain a user names as a choice (the domain for a new actor): a bare
 * authority, optionally behind a scheme, with no path, userinfo, query or
 * wildcard. Normalised as `getServedAuthority` does, so `Alias.Example.` and
 * `alias.example` are one domain. Null for anything else.
 */
export const normalizeServedDomainChoice = (
  value: string | undefined | null
): string | null => {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  if (!withoutScheme || /[@/?#\\\s]/.test(withoutScheme)) return null
  if (withoutScheme.includes('*')) return null
  const authority = getServedAuthority(trimmed)
  // The parser keeps `"`, `'`, `&` and the like in a hostname, and a chosen
  // domain becomes part of actor ids and links, so a choice has to be an
  // ordinary DNS name (IDNA has already turned Unicode into `xn--` labels) or
  // a bracketed IPv6 literal, with an optional port.
  if (
    !authority ||
    !/^(?:[a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(?::\d+)?$/.test(
      authority
    )
  ) {
    return null
  }
  return authority
}

/**
 * A matcher for URLs or hosts against `rules` (the served-domain rules, or the
 * federation policy's wider local set), prepared once. Each value is reduced
 * with `getServedAuthority` first, so an ActivityPub id, a key id or an inbox
 * URL can be passed as is.
 */
export const createServedDomainMatcher = (
  rules: readonly string[]
): ((value: string | undefined | null) => boolean) => {
  const matches = createHostRulesMatcher(rules)
  return (value) => {
    const authority = getServedAuthority(value)
    if (!authority) return false
    return matches(authority)
  }
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
