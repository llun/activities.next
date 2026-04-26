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
  const localDomains = config.allowActorDomains?.length
    ? config.allowActorDomains
    : [config.host]

  return localDomains.some((localDomain) =>
    domainMatchesRule(domain, localDomain)
  )
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
  const domainResults = await Promise.all(
    domains.map(async (domain) => ({
      domain,
      allowed: await canFederateWithDomain(database, domain)
    }))
  )
  const allowedDomains = new Set(
    domainResults
      .filter((result) => result.allowed)
      .map((result) => result.domain)
  )

  return uniqueUrls.filter((url) => {
    const domain = getDomainFromUrl(url)
    return domain ? allowedDomains.has(domain) : false
  })
}
