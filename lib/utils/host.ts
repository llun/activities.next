type HostRuleConfig = {
  host?: string | null
  allowActorDomains?: readonly string[] | null
  trustedHosts?: readonly string[] | null
}

const normalizedRulesCache = new Map<string, string[]>()

type HostParts = {
  hasWildcard: boolean
  hostname: string
  port: string
}

const hostPartsCache = new Map<string, HostParts>()

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
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
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
  hostPartsCache.set(normalizedHost, hostParts)
  return hostParts
}

export const normalizeHostRules = (rules: readonly string[]) => {
  const cacheKey = JSON.stringify(rules)
  const cachedRules = normalizedRulesCache.get(cacheKey)
  if (cachedRules) return cachedRules

  const normalizedRules = rules.flatMap((rule) => {
    const normalizedRule = normalizeHost(rule)
    return normalizedRule ? [normalizedRule] : []
  })
  normalizedRulesCache.set(cacheKey, normalizedRules)
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
      hostParts.port === ruleParts.port
    )
  }

  return (
    hostParts.hostname === ruleParts.hostname &&
    hostParts.port === ruleParts.port
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
