import { type Config, getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import {
  type ServedDomainSources,
  getCanonicalAuthority,
  isServedDomain,
  normalizeServedDomainChoice
} from '@/lib/utils/host'

export type LocalDomainMatcher = (value: string | undefined | null) => boolean

type LocalDomainConfig = Pick<Config, 'host' | 'trustedHosts'>

/**
 * The sources of "our domains" once the server settings are resolved: the
 * env-only host and trusted hosts plus the resolved actor-domain list. Kept
 * synchronous for callers that already hold the resolved settings (the
 * federation policy resolves them once per operation).
 */
export const getServedDomainSources = (
  config: LocalDomainConfig,
  allowActorDomains: readonly string[]
): ServedDomainSources => ({
  host: config.host,
  trustedHosts: config.trustedHosts ?? null,
  allowActorDomains
})

export const createLocalDomainMatcher =
  (sources: ServedDomainSources): LocalDomainMatcher =>
  (value) =>
    isServedDomain(value, sources)

/**
 * Resolves the served-domain sources once and returns a synchronous matcher,
 * so a loop over many URLs pays one settings read. The settings resolver
 * caches per database instance, so this is cheap on hot paths too.
 */
export const getLocalDomainMatcher = async (
  database: Database | null
): Promise<LocalDomainMatcher> => {
  const { federation } = await getResolvedServerSettings(database)
  return createLocalDomainMatcher(
    getServedDomainSources(getConfig(), federation.allowActorDomains)
  )
}

/**
 * Whether a URL (an actor id, a key id, an inbox) or a bare host is on a domain
 * this server serves. See `isServedDomain` for the rules.
 */
export const isLocalDomain = async (
  database: Database | null,
  value: string | undefined | null
): Promise<boolean> => (await getLocalDomainMatcher(database))(value)

/**
 * The domain a user-facing link (a confirmation email, say) should be built on
 * for an account whose actor lives on `domain`: that domain, normalised, when
 * this server serves it, so the link opens where the account's actor is.
 * Null — meaning "use the primary host" — for the primary host itself, a
 * missing or malformed domain,
 * one carrying a path or a wildcard, and any domain this server does not
 * serve, so a stored value can never point a link at another server.
 */
export const getServedLinkDomain = async (
  database: Database | null,
  domain: string | undefined | null
): Promise<string | null> => {
  const authority = normalizeServedDomainChoice(domain)
  if (!authority) return null
  // The primary host keeps the `getBaseURL()` link it always had.
  if (getCanonicalAuthority(getConfig().host) === authority) return null
  return (await isLocalDomain(database, authority)) ? authority : null
}
