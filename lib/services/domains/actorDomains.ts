import { type Config } from '@/lib/config'
import {
  getServedAuthority,
  getTrustedHostRules,
  isHostServedByRules,
  normalizeServedDomainChoice
} from '@/lib/utils/host'

type ActorDomainConfig = Pick<Config, 'host' | 'trustedHosts'>

/**
 * The rules a new actor's domain has to match. The resolved
 * `federation.allowActorDomains` setting is the list when it is non-empty;
 * otherwise an actor may live on the primary host or any
 * `ACTIVITIES_TRUSTED_HOSTS` entry. Entries may be `*.example.com` wildcards.
 */
export const getActorDomainRules = (
  config: ActorDomainConfig,
  allowActorDomains: readonly string[]
): string[] =>
  allowActorDomains.length
    ? [...allowActorDomains]
    : getTrustedHostRules(config)

/**
 * The concrete domains to offer as choices: every rule that names one domain,
 * normalised (lower case, no trailing dot, scheme, path or default port) and
 * de-duplicated in order. A wildcard rule names no single domain, so it is never offered as
 * if it were one; a domain it covers is still accepted by `resolveActorDomain`.
 */
export const getActorDomainChoices = (rules: readonly string[]): string[] => [
  ...new Set(
    rules
      .map((rule) => normalizeServedDomainChoice(getServedAuthority(rule)))
      .filter((domain): domain is string => domain !== null)
  )
]

/**
 * The domain to create an actor on, normalised, when `requested` is a bare
 * domain that matches one of `rules` (exactly, or under a wildcard); null
 * otherwise. Matching uses the same rules as every other served-domain check,
 * so casing, a trailing dot or a default port cannot make an allowed domain
 * look foreign, and a wildcard rule spelled literally is never a domain.
 */
export const resolveActorDomain = (
  requested: string | undefined | null,
  rules: readonly string[]
): string | null => {
  const domain = normalizeServedDomainChoice(requested)
  if (!domain) return null
  return isHostServedByRules(domain, rules) ? domain : null
}
