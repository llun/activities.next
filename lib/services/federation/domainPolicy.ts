import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'

import {
  FederationMode,
  domainMatchesRule,
  normalizeDomain,
  shouldSuspendDomainBlock
} from './domainRules'

export const getDomainFromUrl = (value: string): string | null =>
  normalizeDomain(value)

export const getFederationMode = (): FederationMode =>
  getConfig().federationMode ?? 'open'

export const isLocalFederationDomain = (value: string): boolean => {
  const domain = getDomainFromUrl(value)
  if (!domain) return false

  const config = getConfig()
  const host = normalizeDomain(config.host)
  if (domain === host) return true

  return (config.allowActorDomains ?? []).some((localDomain) => {
    const normalized = normalizeDomain(localDomain)
    if (!normalized) return false
    if (normalized.startsWith('*.'))
      return domainMatchesRule(domain, normalized)
    return domain === normalized
  })
}

/**
 * The instance's concrete (non-wildcard) local domains: the configured host
 * plus every entry in `allowActorDomains`. Wildcard patterns are dropped since
 * they cannot be used as a literal domain to query an actor by. Useful for
 * resolving a local username that may live on a different served domain than
 * the one a client addressed it by (multi-domain hosting).
 */
export const getLocalActorDomains = (): string[] => {
  const config = getConfig()
  const domains = [config.host, ...(config.allowActorDomains ?? [])]
    .map((domain) => normalizeDomain(domain))
    .filter(
      (domain): domain is string => domain !== null && !domain.startsWith('*.')
    )

  return Array.from(new Set(domains))
}

export const isDomainBlocked = async (
  database: Database,
  value: string
): Promise<boolean> => {
  const domain = getDomainFromUrl(value)
  if (!domain) return false

  const block = await database.getDomainBlockForDomain(domain)
  return block ? shouldSuspendDomainBlock(block) : false
}

export const isDomainAllowed = async (
  database: Database,
  value: string
): Promise<boolean> => {
  const domain = getDomainFromUrl(value)
  if (!domain) return false
  if (isLocalFederationDomain(domain)) return true

  return Boolean(await database.getDomainAllowForDomain(domain))
}

export const canFederateWithDomain = async (
  database: Database,
  value: string
): Promise<boolean> => {
  const domain = getDomainFromUrl(value)
  if (!domain) return false
  if (isLocalFederationDomain(domain)) return true

  if (await isDomainBlocked(database, domain)) return false

  if (getFederationMode() === 'allowlist') {
    return isDomainAllowed(database, domain)
  }

  return true
}

const getFederationDecisionsForDomains = async (
  database: Database,
  domains: string[]
): Promise<Map<string, boolean>> => {
  const uniqueDomains = [...new Set(domains)]
  const decisions = new Map<string, boolean>()
  const remoteDomains: string[] = []

  for (const domain of uniqueDomains) {
    if (isLocalFederationDomain(domain)) {
      decisions.set(domain, true)
    } else {
      remoteDomains.push(domain)
    }
  }

  if (remoteDomains.length === 0) return decisions

  const blockRules = await database.getDomainBlocksForDomains(remoteDomains)
  const unblockedDomains = remoteDomains.filter((domain) => {
    const block = blockRules[domain] ?? null
    const isBlocked = block ? shouldSuspendDomainBlock(block) : false
    decisions.set(domain, !isBlocked)
    return !isBlocked
  })

  if (getFederationMode() !== 'allowlist' || unblockedDomains.length === 0) {
    return decisions
  }

  const allowRules = await database.getDomainAllowsForDomains(unblockedDomains)
  for (const domain of unblockedDomains) {
    decisions.set(domain, Boolean(allowRules[domain]))
  }

  return decisions
}

export const filterFederatedUrls = async (
  database: Database,
  urls: string[]
): Promise<string[]> => {
  const uniqueUrls = [...new Set(urls)]
  const domains = [
    ...new Set(
      uniqueUrls
        .map((url) => getDomainFromUrl(url))
        .filter((domain): domain is string => domain !== null)
    )
  ]
  const decisions = await getFederationDecisionsForDomains(database, domains)

  return uniqueUrls.filter((url) => {
    const domain = getDomainFromUrl(url)
    return domain ? decisions.get(domain) === true : false
  })
}
