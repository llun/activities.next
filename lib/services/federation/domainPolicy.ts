import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'

import {
  FederationMode,
  domainMatchesRule,
  findMatchingDomainRule,
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

  const allows = await database.getDomainAllows()
  return Boolean(findMatchingDomainRule(domain, allows))
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
  const allowed = await Promise.all(
    uniqueUrls.map(async (url) =>
      (await canFederateWithDomain(database, url)) ? url : null
    )
  )

  return allowed.filter((url): url is string => url !== null)
}
