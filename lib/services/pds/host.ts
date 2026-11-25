import {
  type BlueskyPdsConfig,
  type BlueskyPdsDomainConfig,
  getPdsConfig,
  getPdsDomainForHostname
} from '@/lib/config/blueskyPds'
import { createLocalDomainMatcher } from '@/lib/services/domains/localDomains'
import {
  getServedHostConfig,
  isServedDomainSnapshotFresh
} from '@/lib/services/domains/servedDomainSnapshot'
import { getHeaderValue } from '@/lib/utils/getHeaderValue'
import {
  HOST_HEADER_NAMES,
  type HostHeaders,
  getHostHeaderValue,
  normalizeServedDomainChoice
} from '@/lib/utils/host'
import { logger } from '@/lib/utils/logger'

const MAX_WARNED_COLLISION_KEYS = 256
const warnedCollisionKeys = new Set<string>()

/**
 * Extracts the raw request host using the same header precedence and
 * normalization as `getDomainCheckRequestHost` (`x-activity-next-host`,
 * `x-forwarded-host`, `host`) without falling back to the primary host.
 *
 * Returns `null` when no valid host header is present.
 */
export const getPdsRequestHost = (headers: HostHeaders): string | null => {
  for (const name of HOST_HEADER_NAMES) {
    const value = getHostHeaderValue(headers, name)?.trim()
    if (!value) continue
    // A list (an appending proxy's X-Forwarded-Host) starts with whatever the
    // client sent, so the PDS refuses it rather than trusting its first entry.
    if (value.includes(',')) return null
    return normalizeServedDomainChoice(value)
  }
  return null
}

/**
 * Resolves the enabled Bluesky PDS domain configuration matching the exact raw
 * request hostname, or `null` when PDS is unconfigured, disabled, the request
 * arrived on any other host, the served-domain snapshot has not loaded yet or
 * is stale/errored, the hostname collides with a served domain of this
 * instance (`ACTIVITIES_HOST`, concrete `ACTIVITIES_TRUSTED_HOSTS`, or an
 * active `domains` row), or the raw `Host` header is present, differs from the
 * resolved PDS hostname, and is itself a served domain of this instance.
 */
export const getPdsDomainForRequest = (
  headers: HostHeaders,
  config: BlueskyPdsConfig | null = getPdsConfig(),
  servedHostConfig?: ReturnType<typeof getServedHostConfig>
): BlueskyPdsDomainConfig | null => {
  if (!config) return null
  const hostname = getPdsRequestHost(headers)
  if (!hostname) return null
  const matched = getPdsDomainForHostname(hostname, config)
  if (!matched) return null

  if (servedHostConfig === undefined && !isServedDomainSnapshotFresh()) {
    // Trigger a background refresh when a database is registered, while
    // failing closed until a fresh snapshot has been loaded.
    getServedHostConfig()
    return null
  }

  const effectiveServedHostConfig = servedHostConfig ?? getServedHostConfig()
  const isServedDomain = createLocalDomainMatcher(effectiveServedHostConfig)
  if (isServedDomain(hostname)) {
    const warningKey = `${matched.domain}:${hostname}`
    if (!warnedCollisionKeys.has(warningKey)) {
      if (warnedCollisionKeys.size >= MAX_WARNED_COLLISION_KEYS) {
        warnedCollisionKeys.clear()
      }
      warnedCollisionKeys.add(warningKey)
      logger.warn({
        domain: matched.domain,
        hostname,
        message:
          'Refusing Bluesky PDS request because the PDS hostname collides with a served domain of this instance'
      })
    }
    return null
  }

  // Stop a client-sent single X-Forwarded-Host (or X-Activity-Next-Host) on a
  // served domain behind a Host-preserving proxy: when raw Host is present,
  // differs from the resolved PDS hostname, and names a served domain of this
  // instance (or is a comma list), refuse the request.
  const rawHostValue = getHeaderValue(headers, 'host')?.trim()
  if (rawHostValue) {
    if (rawHostValue.includes(',')) return null
    const rawHost = normalizeServedDomainChoice(rawHostValue)
    if (rawHost && rawHost !== hostname && isServedDomain(rawHost)) {
      return null
    }
  }

  return matched
}

export const resetPdsHostCollisionWarningsForTests = (): void => {
  warnedCollisionKeys.clear()
}
