import { type Config, getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import {
  createServedDomainMatcher,
  getCanonicalAuthority,
  getServedDomainRules,
  isOwnInstanceHost,
  normalizeServedDomainChoice
} from '@/lib/utils/host'

export type LocalDomainMatcher = (value: string | undefined | null) => boolean

type LocalDomainConfig = Pick<Config, 'host' | 'trustedHosts'>

// One prepared matcher per config object: `getConfig()` hands back the same
// object for the life of the process, so the hot paths (search, forwarding
// fan-out, every inbound reaction) never rebuild the rule list.
const matcherCache = new WeakMap<LocalDomainConfig, LocalDomainMatcher>()

/**
 * The served-domain matcher for `config`: the primary host and the concrete
 * `ACTIVITIES_TRUSTED_HOSTS` entries (see `ServedDomainSources` in
 * `@/lib/utils/host`). Synchronous, with the rules prepared once, so it can run
 * inside per-URL loops.
 */
export const createLocalDomainMatcher = (
  config: LocalDomainConfig
): LocalDomainMatcher => {
  const cached = matcherCache.get(config)
  if (cached) return cached
  const matcher = createServedDomainMatcher(getServedDomainRules(config))
  matcherCache.set(config, matcher)
  return matcher
}

/**
 * The served-domain matcher at request time. Every source is configuration
 * today, so `database` is unused; it is part of the signature so the planned
 * database-backed domain list can join the sources without touching a caller.
 */
export const getLocalDomainMatcher = async (
  _database: Database | null
): Promise<LocalDomainMatcher> => createLocalDomainMatcher(getConfig())

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
 * this server answers on it — the primary host or any `ACTIVITIES_TRUSTED_HOSTS`
 * entry, wildcards included, the same set better-auth trusts as origins and
 * `selectHeaderHost` accepts — so the link opens where the account's actor is.
 * Null — meaning "use the primary host" — for the primary host itself, a
 * missing or malformed domain, one carrying a path or a wildcard, and any
 * domain this server does not answer on, so a stored value can never point a
 * link at another server.
 */
export const getServedLinkDomain = (
  domain: string | undefined | null
): string | null => {
  const authority = normalizeServedDomainChoice(domain)
  if (!authority) return null
  const config = getConfig()
  // The primary host keeps the `getBaseURL()` link it always had.
  if (getCanonicalAuthority(config.host) === authority) return null
  return isOwnInstanceHost(authority, config) ? authority : null
}
