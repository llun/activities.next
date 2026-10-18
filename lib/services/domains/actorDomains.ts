import { type Config } from '@/lib/config'
import {
  getServedAuthority,
  getServedDomainRules,
  isHostServedByRules,
  normalizeServedDomainChoice
} from '@/lib/utils/host'

type ActorDomainConfig = Pick<Config, 'host' | 'trustedHosts'>

/**
 * The rules a new actor's domain has to match. The resolved
 * `federation.allowActorDomains` setting is the list when it is non-empty, and
 * its `*.example.com` wildcards approve their subdomains, since the operator
 * wrote them for exactly that. Otherwise an actor may live on the primary host
 * or a CONCRETE `ACTIVITIES_TRUSTED_HOSTS` entry: a wildcard trusted host
 * exists to trust `X-Forwarded-Host` (preview deployments, say) and must not
 * let anyone create actors on arbitrary subdomains.
 */
export const getActorDomainRules = (
  config: ActorDomainConfig,
  allowActorDomains: readonly string[]
): string[] =>
  allowActorDomains.length
    ? [...allowActorDomains]
    : getServedDomainRules(config)

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

/**
 * The concrete domains to offer as choices: every rule that names one domain,
 * normalised (lower case, no trailing dot, scheme, path or default port) and
 * de-duplicated in order, then `currentHost` (the host the request arrived on)
 * when the rules allow it, so a user on a subdomain a wildcard rule approves
 * can pick the domain they are on. A wildcard rule names no single domain, so
 * it is never offered as if it were one; a domain it covers is still accepted
 * by `resolveActorDomain`.
 */
export const getActorDomainChoices = (
  rules: readonly string[],
  currentHost?: string | null
): string[] => {
  const choices = rules
    .map((rule) => normalizeServedDomainChoice(getServedAuthority(rule)))
    .filter((domain): domain is string => domain !== null)
  const current = resolveActorDomain(currentHost, rules)
  return [...new Set(current ? [...choices, current] : choices)]
}
