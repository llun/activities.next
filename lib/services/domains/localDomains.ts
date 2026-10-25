import { type Config, getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import {
  ensureServedDomainsFresh,
  getServedHostConfig
} from '@/lib/services/domains/servedDomainSnapshot'
import {
  createServedDomainMatcher,
  getCanonicalAuthority,
  getServedDomainRules,
  isOwnInstanceHost,
  normalizeServedDomainChoice
} from '@/lib/utils/host'

export type LocalDomainMatcher = (value: string | undefined | null) => boolean

type LocalDomainConfig = Pick<Config, 'host' | 'trustedHosts'> & {
  servedDomains?: readonly string[] | null
}

// One prepared matcher per config object: `getServedHostConfig()` hands back
// the same object until the active database domains change, so the hot paths
// (search, forwarding fan-out, every inbound reaction) never rebuild the rule
// list.
const matcherCache = new WeakMap<LocalDomainConfig, LocalDomainMatcher>()

/**
 * The served-domain matcher for `config`: the primary host, the concrete
 * `ACTIVITIES_TRUSTED_HOSTS` entries and the active Admin › Served domains rows (see
 * `ServedDomainSources` in `@/lib/utils/host`). Synchronous, with the rules prepared once, so it can run
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
 * The served-domain matcher at request time: the env domains plus the active
 * `domains` rows, from the snapshot (`servedDomainSnapshot`), which is brought
 * up to date first when it is older than its refresh interval. `database`
 * stays in the signature for the callers; the snapshot reads the database the
 * process registered at startup.
 */
export const getLocalDomainMatcher = async (
  _database: Database | null
): Promise<LocalDomainMatcher> => {
  await ensureServedDomainsFresh()
  return createLocalDomainMatcher(getServedHostConfig())
}

/**
 * Whether a URL (an actor id, a key id, an inbox) or a bare host is on a domain
 * this server serves. The served domains are the primary host and the concrete
 * `ACTIVITIES_TRUSTED_HOSTS` entries (see `ServedDomainSources`).
 */
export const isLocalDomain = async (
  database: Database | null,
  value: string | undefined | null
): Promise<boolean> => (await getLocalDomainMatcher(database))(value)

/**
 * The domain a user-facing link (a confirmation email, say) should be built on
 * for an account whose actor lives on `domain`: that domain, normalised, when
 * this server answers on it — the primary host, any `ACTIVITIES_TRUSTED_HOSTS`
 * entry (wildcards included) or an active Admin › Served domains row, the same set
 * better-auth trusts as origins and `selectHeaderHost` accepts — so the link
 * opens where the account's actor is.
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
  return isOwnInstanceHost(authority, getServedHostConfig(config))
    ? authority
    : null
}
