import { type Config } from '@/lib/config'
import {
  getServedAuthority,
  getServedDomainRules,
  isHostServedByRules,
  normalizeServedDomainChoice
} from '@/lib/utils/host'

type ActorDomainConfig = Pick<Config, 'host' | 'trustedHosts'>

/**
 * The rules a new actor's domain has to match. When the resolved
 * `federation.allowActorDomains` setting is non-empty, its CONCRETE entries are
 * the list: a `*.example.com` wildcard there keeps its federation-policy
 * exemption (`domainPolicy.ts`) but approves no domain for actor creation, since
 * in allowlist mode the setting can name remote servers and a user must not
 * mint a local actor on someone else's subdomain. A list holding only wildcards
 * is still "non-empty": it approves nothing and does not fall back. Otherwise an
 * actor may live on the primary host or a CONCRETE `ACTIVITIES_TRUSTED_HOSTS`
 * entry: a wildcard trusted host exists to trust `X-Forwarded-Host` (preview
 * deployments, say) and must not let anyone create actors on arbitrary
 * subdomains.
 */
export const getActorDomainRules = (
  config: ActorDomainConfig,
  allowActorDomains: readonly string[]
): string[] =>
  allowActorDomains.length
    ? allowActorDomains.filter((rule) => !rule.includes('*'))
    : getServedDomainRules(config)

/**
 * The domain to create an actor on, normalised, when `requested` is a bare
 * domain that matches one of `rules`; null
 * otherwise. Matching uses the same rules as every other served-domain check,
 * so casing, a trailing dot or a default port cannot make an allowed domain
 * look foreign, and a wildcard rule spelled literally is never a domain. Pass
 * the output of `getActorDomainRules`, which holds no wildcards.
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
 * only when the rules allow it. A wildcard rule names no single domain, so it
 * is never offered, and it never approves `currentHost`.
 */
export const getActorDomainChoices = (
  rules: readonly string[],
  currentHost?: string | null
): string[] => {
  const concrete = rules.filter((rule) => !rule.includes('*'))
  const choices = concrete
    .map((rule) => normalizeServedDomainChoice(getServedAuthority(rule)))
    .filter((domain): domain is string => domain !== null)
  const current = resolveActorDomain(currentHost, concrete)
  return [...new Set(current ? [...choices, current] : choices)]
}
