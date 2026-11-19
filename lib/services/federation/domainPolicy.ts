import { Database } from '@/lib/database/types'
import { type LocalDomainMatcher } from '@/lib/services/domains/localDomains'
import {
  ensureServedDomainsFresh,
  getServedHostConfig
} from '@/lib/services/domains/servedDomainSnapshot'
import { FederationPolicyUnavailableError } from '@/lib/services/federation/policyUnavailable'
import { getServerSettingsView } from '@/lib/services/serverSettings'
import {
  createServedDomainMatcher,
  getServedDomainRules
} from '@/lib/utils/host'

import {
  FederationMode,
  normalizeDomain,
  shouldSuspendDomainBlock
} from './domainRules'

export const getDomainFromUrl = (value: string): string | null =>
  normalizeDomain(value)

// The federation mode and actor allow-list are database-backed settings
// (env -> database -> default). Resolve them once per operation; the resolver
// caches per database instance so hot paths (inbox verification, delivery
// fan-out) do not pay a database read per call.
//
// `isLocal` is the set exempt from federation policy: the served domains
// (`getServedDomainRules`: the configured host and the concrete
// `ACTIVITIES_TRUSTED_HOSTS` entries) plus every resolved
// `federation.allowActorDomains` entry, its `*.example.com` wildcards
// included, as on every release before the served-domain helper existed. The
// actor allow-list is exempt here only: it is not part of the served-domain
// set search, quotes, forwarding and emoji use, because in allowlist mode the
// admin form presents it as "Allowed servers" and it can hold remote ones.
// The matcher is prepared once per operation and is synchronous so it can run
// inside per-URL loops. A local domain skips the block and allow-list lookups
// only; it never stands in for a signature or ownership check, which every
// inbound path still makes.
const getFederationPolicy = async (
  database: Database
): Promise<{
  mode: FederationMode
  isLocal: LocalDomainMatcher
  unknown: boolean
}> => {
  const [view] = await Promise.all([
    getServerSettingsView(database),
    ensureServedDomainsFresh()
  ])
  const { federation } = view.settings
  const unknown =
    Boolean(view.degraded) &&
    !(
      view.locks['federation.mode']?.locked &&
      (federation.mode === 'open' ||
        view.locks['federation.allowActorDomains']?.locked)
    )
  return {
    mode: federation.mode,
    // The defaults stand in for unread stored settings, or a replaced view
    // for current ones. The policy is still known when the env pins an open
    // mode, or an allowlist mode together with its allowed servers (otherwise
    // those servers would read as refused).
    unknown,
    // An unread or replaced actor-domain list is not trusted to exempt a
    // host, even when the mode is pinned: a stale entry would skip the block
    // lookup, and a remote "allowed server" is then undecidable, not local.
    isLocal: createServedDomainMatcher([
      ...getServedDomainRules(getServedHostConfig()),
      ...(!view.degraded || view.locks['federation.allowActorDomains']?.locked
        ? federation.allowActorDomains
        : [])
    ])
  }
}

export const getFederationMode = async (
  database: Database
): Promise<FederationMode> => (await getFederationPolicy(database)).mode

export const isLocalFederationDomain = async (
  database: Database,
  value: string
): Promise<boolean> => {
  const { isLocal } = await getFederationPolicy(database)
  return isLocal(value)
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

  const { isLocal } = await getFederationPolicy(database)
  // The value, not `domain`: `getDomainFromUrl` drops the port, and the
  // served-domain rules compare it (a `localhost:3000` instance is local only
  // on that port).
  if (isLocal(value)) return true

  return Boolean(await database.getDomainAllowForDomain(domain))
}

export const canFederateWithDomain = async (
  database: Database,
  value: string
): Promise<boolean> => {
  const domain = getDomainFromUrl(value)
  if (!domain) return false

  const { mode, isLocal, unknown } = await getFederationPolicy(database)
  if (isLocal(value)) return true

  if (await isDomainBlocked(database, domain)) return false

  if (mode === 'allowlist' || unknown) {
    if (await database.getDomainAllowForDomain(domain)) return true
    // Unknown mode: only an allow row is a yes that holds in both modes.
    if (unknown) throw new FederationPolicyUnavailableError()
    return false
  }

  return true
}

const getFederationDecisionsForDomains = async (
  database: Database,
  mode: FederationMode,
  domains: string[],
  unknown = false
): Promise<Map<string, boolean>> => {
  const remoteDomains = [...new Set(domains)]
  const decisions = new Map<string, boolean>()

  if (remoteDomains.length === 0) return decisions

  const blockRules = await database.getDomainBlocksForDomains(remoteDomains)
  const unblockedDomains = remoteDomains.filter((domain) => {
    const block = blockRules[domain] ?? null
    const isBlocked = block ? shouldSuspendDomainBlock(block) : false
    decisions.set(domain, !isBlocked)
    return !isBlocked
  })

  if ((mode !== 'allowlist' && !unknown) || unblockedDomains.length === 0) {
    return decisions
  }

  const allowRules = await database.getDomainAllowsForDomains(unblockedDomains)
  for (const domain of unblockedDomains) {
    // Unknown mode: an unlisted domain is neither a yes nor a safe no.
    if (unknown && !allowRules[domain]) {
      throw new FederationPolicyUnavailableError()
    }
    decisions.set(domain, Boolean(allowRules[domain]))
  }

  return decisions
}

export const filterFederatedUrls = async (
  database: Database,
  urls: string[]
): Promise<string[]> => {
  const { mode, isLocal, unknown } = await getFederationPolicy(database)
  const uniqueUrls = [...new Set(urls)]
  // Locality is decided per URL rather than per domain, because the
  // served-domain rules compare the port that `getDomainFromUrl` drops.
  const localUrls = new Set(uniqueUrls.filter((url) => isLocal(url)))
  const domains = [
    ...new Set(
      uniqueUrls
        .filter((url) => !localUrls.has(url))
        .map((url) => getDomainFromUrl(url))
        .filter((domain): domain is string => domain !== null)
    )
  ]
  const decisions = await getFederationDecisionsForDomains(
    database,
    mode,
    domains,
    unknown
  )

  return uniqueUrls.filter((url) => {
    if (localUrls.has(url)) return true
    const domain = getDomainFromUrl(url)
    return domain ? decisions.get(domain) === true : false
  })
}
