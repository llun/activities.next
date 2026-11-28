import { type Config, getConfig } from '@/lib/config'
import {
  getServedAuthority,
  normalizeServedDomainChoice
} from '@/lib/utils/host'

// Kept apart from `adminDomains` so the PDS barrel can read the env domains
// without loading the database layer.

export type EnvDomainConfig = Pick<Config, 'host' | 'trustedHosts'>

export type EnvDomains = {
  // ACTIVITIES_HOST, normalised as a trusted host is; null when it names none.
  primary: string | null
  // The concrete ACTIVITIES_TRUSTED_HOSTS entries, normalised, primary excluded.
  trusted: string[]
  // The wildcard ACTIVITIES_TRUSTED_HOSTS entries, as written.
  wildcards: string[]
}

/** The domains the environment configures, split the way the admin page shows them. */
export const getEnvDomains = (
  config: EnvDomainConfig = getConfig()
): EnvDomains => {
  const primary = normalizeServedDomainChoice(getServedAuthority(config.host))
  const trusted: string[] = []
  const wildcards: string[] = []
  for (const raw of config.trustedHosts ?? []) {
    const rule = raw.trim()
    if (!rule) continue
    if (rule.includes('*')) {
      wildcards.push(rule)
      continue
    }
    const domain = normalizeServedDomainChoice(getServedAuthority(rule))
    if (domain && domain !== primary && !trusted.includes(domain)) {
      trusted.push(domain)
    }
  }
  return { primary, trusted, wildcards }
}

/** Whether a normalised domain is the primary, a concrete trusted host, or neither (null). */
export const getEnvDomainKind = (
  domain: string,
  env: EnvDomains = getEnvDomains()
): 'primary' | 'env' | null => {
  if (env.primary === domain) return 'primary'
  if (env.trusted.includes(domain)) return 'env'
  return null
}
