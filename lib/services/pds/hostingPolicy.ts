import {
  type BlueskyPdsConfig,
  type BlueskyPdsDomainConfig,
  getPdsConfig,
  matchesPdsAllowList
} from '@/lib/config/blueskyPds'
import type { ServedDomainData } from '@/lib/database/domains/servedDomain/types'
import type { Database } from '@/lib/database/types'
import { getEnvDomains } from '@/lib/services/domains/envDomains'
import { normalizeServedDomainChoice } from '@/lib/utils/host'

import type { BlueskyHostingPolicy } from './hostingPolicyTypes'

// Who may host a Bluesky account on a served domain: the domain's saved
// setting when it has one, otherwise the ACTIVITIES_BLUESKY_PDS allowlists.
// The decision reads the domain's row at decision time (hosting decisions are
// rare), never the served-domain snapshot: a stale snapshot must not fall back
// to the environment's lists. Whether the domain's PDS is on at all stays the
// environment's call.

export type EffectiveBlueskyHostingPolicy = {
  // 'domain': the admin saved a setting on the domain. 'environment': the
  // domain has none, so the env allowlists decide (an allowlist, i.e. 'listed').
  source: 'domain' | 'environment'
  policy: BlueskyHostingPolicy
  allowEmails: string[]
  allowActors: string[]
}

const resolveEntry = (
  domain: string,
  config: BlueskyPdsConfig | null
): { domain: string; entry: BlueskyPdsDomainConfig } | null => {
  const normalized = normalizeServedDomainChoice(domain)
  if (!normalized) return null
  const entry = config?.[normalized]
  return entry ? { domain: normalized, entry } : null
}

// A domain the environment pins: ACTIVITIES_HOST or a concrete
// ACTIVITIES_TRUSTED_HOSTS entry. A wildcard entry is not a served domain.
const isEnvPinnedDomain = (domain: string): boolean => {
  const env = getEnvDomains()
  return env.primary === domain || env.trusted.includes(domain)
}

// The saved setting, or the environment's lists when the row confirms none is
// saved (NULL) or the domain has no row and the environment pins it. Null when
// neither applies: no policy, so nobody.
const effectiveFromRow = (
  resolved: { domain: string; entry: BlueskyPdsDomainConfig },
  row: ServedDomainData | null
): EffectiveBlueskyHostingPolicy | null => {
  if (row?.blueskyHostingPolicy) {
    return {
      source: 'domain',
      policy: row.blueskyHostingPolicy,
      allowEmails: row.blueskyHostingAllowEmails ?? [],
      allowActors: row.blueskyHostingAllowActors ?? []
    }
  }
  if (row || isEnvPinnedDomain(resolved.domain)) {
    return {
      source: 'environment',
      policy: 'listed',
      allowEmails: resolved.entry.allowEmails,
      allowActors: resolved.entry.allowActors
    }
  }
  return null
}

/**
 * The policy that decides who may host on `domain`: its saved setting, or the
 * environment's allowlists when it has none. Null when the domain has no
 * ACTIVITIES_BLUESKY_PDS entry, or no row and no environment pin.
 */
export const getEffectiveHostingPolicy = async (
  database: Database,
  domain: string,
  config: BlueskyPdsConfig | null = getPdsConfig()
): Promise<EffectiveBlueskyHostingPolicy | null> => {
  const resolved = resolveEntry(domain, config)
  if (!resolved) return null
  const row = await database.getServedDomain({ domain: resolved.domain })
  return effectiveFromRow(resolved, row)
}

/**
 * Whether this profile may host a Bluesky account on its domain. The domain's
 * PDS must be enabled in ACTIVITIES_BLUESKY_PDS and the domain must be served
 * (an `on` row, or pinned by the environment); the policy then decides who:
 * 'nobody' allows nobody, 'listed' the saved emails and profiles, 'everyone'
 * every profile on the domain. The callers still apply the blocked checks
 * (suspended, unconfirmed, unapproved, deleting, disabled).
 */
export const isHostingAllowed = async ({
  database,
  email,
  actorUsernameAtDomain,
  domain,
  config = getPdsConfig()
}: {
  database: Database
  email?: string | null
  actorUsernameAtDomain?: string | null
  domain: string
  config?: BlueskyPdsConfig | null
}): Promise<boolean> => {
  const resolved = resolveEntry(domain, config)
  if (!resolved || !resolved.entry.enabled) return false

  const row = await database.getServedDomain({ domain: resolved.domain })
  if (row?.status !== 'on' && !isEnvPinnedDomain(resolved.domain)) return false

  const effective = effectiveFromRow(resolved, row)
  if (!effective) return false
  if (effective.policy === 'nobody') return false
  if (effective.policy === 'everyone') return true
  return matchesPdsAllowList({
    email,
    actorUsernameAtDomain,
    allowEmails: effective.allowEmails,
    allowActors: effective.allowActors
  })
}
