import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

import {
  FederationMode,
  domainMatchesRule,
  normalizeDomain,
  shouldSuspendDomainBlock
} from './domainRules'

export const getDomainFromUrl = (value: string): string | null =>
  normalizeDomain(value)

// The federation mode and actor allow-list are database-backed settings
// (env -> database -> default). Resolve them once per operation; the resolver
// caches per database instance so hot paths (inbox verification, delivery
// fan-out) do not pay a database read per call.
const getFederationPolicy = async (
  database: Database
): Promise<{ mode: FederationMode; allowActorDomains: string[] }> => {
  const { federation } = await getResolvedServerSettings(database)
  return {
    mode: federation.mode,
    allowActorDomains: federation.allowActorDomains
  }
}

// Pure local-domain check against the configured host (env-only) plus the
// resolved actor allow-list. Kept synchronous so it can run inside per-domain
// loops without awaiting the resolver each time.
const isLocalDomain = (value: string, allowActorDomains: string[]): boolean => {
  const domain = getDomainFromUrl(value)
  if (!domain) return false

  const host = normalizeDomain(getConfig().host)
  if (domain === host) return true

  return allowActorDomains.some((localDomain) => {
    const normalized = normalizeDomain(localDomain)
    if (!normalized) return false
    if (normalized.startsWith('*.'))
      return domainMatchesRule(domain, normalized)
    return domain === normalized
  })
}

export const getFederationMode = async (
  database: Database
): Promise<FederationMode> => (await getFederationPolicy(database)).mode

export const isLocalFederationDomain = async (
  database: Database,
  value: string
): Promise<boolean> => {
  const { allowActorDomains } = await getFederationPolicy(database)
  return isLocalDomain(value, allowActorDomains)
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

  const { allowActorDomains } = await getFederationPolicy(database)
  if (isLocalDomain(domain, allowActorDomains)) return true

  return Boolean(await database.getDomainAllowForDomain(domain))
}

export const canFederateWithDomain = async (
  database: Database,
  value: string
): Promise<boolean> => {
  const domain = getDomainFromUrl(value)
  if (!domain) return false

  const { mode, allowActorDomains } = await getFederationPolicy(database)
  if (isLocalDomain(domain, allowActorDomains)) return true

  if (await isDomainBlocked(database, domain)) return false

  if (mode === 'allowlist') {
    return Boolean(await database.getDomainAllowForDomain(domain))
  }

  return true
}

const getFederationDecisionsForDomains = async (
  database: Database,
  domains: string[]
): Promise<Map<string, boolean>> => {
  const { mode, allowActorDomains } = await getFederationPolicy(database)
  const uniqueDomains = [...new Set(domains)]
  const decisions = new Map<string, boolean>()
  const remoteDomains: string[] = []

  for (const domain of uniqueDomains) {
    if (isLocalDomain(domain, allowActorDomains)) {
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

  if (mode !== 'allowlist' || unblockedDomains.length === 0) {
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
