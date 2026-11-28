import {
  type BlueskyPdsConfig,
  type BlueskyPdsDomainConfig,
  getPdsConfig,
  matchesPdsAllowList
} from '@/lib/config/blueskyPds'
import { getServedHostingPolicy } from '@/lib/services/domains/servedDomainSnapshot'
import { normalizeServedDomainChoice } from '@/lib/utils/host'

import type { BlueskyHostingPolicy } from './hostingPolicyTypes'

// Who may host a Bluesky account on a served domain: the domain's saved
// setting when it has one, otherwise the ACTIVITIES_BLUESKY_PDS allowlists.
// Whether the domain's PDS is on at all stays the environment's call.

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

/**
 * The policy that decides who may host on `domain`: its saved setting, or the
 * environment's allowlists when it has none. Null when the domain has no
 * ACTIVITIES_BLUESKY_PDS entry.
 */
export const getEffectiveHostingPolicy = (
  domain: string,
  config: BlueskyPdsConfig | null = getPdsConfig()
): EffectiveBlueskyHostingPolicy | null => {
  const resolved = resolveEntry(domain, config)
  if (!resolved) return null
  const saved = getServedHostingPolicy(resolved.domain)
  if (saved) return { source: 'domain', ...saved }
  return {
    source: 'environment',
    policy: 'listed',
    allowEmails: resolved.entry.allowEmails,
    allowActors: resolved.entry.allowActors
  }
}

/**
 * Whether this profile may host a Bluesky account on its domain. The domain's
 * PDS must be enabled in ACTIVITIES_BLUESKY_PDS; the policy then decides who:
 * 'nobody' allows nobody, 'listed' the saved emails and profiles, 'everyone'
 * every profile on the domain. The callers still apply the blocked checks
 * (suspended, unconfirmed, unapproved, deleting, disabled).
 */
export const isHostingAllowed = ({
  email,
  actorUsernameAtDomain,
  domain,
  config = getPdsConfig()
}: {
  email?: string | null
  actorUsernameAtDomain?: string | null
  domain: string
  config?: BlueskyPdsConfig | null
}): boolean => {
  const resolved = resolveEntry(domain, config)
  if (!resolved || !resolved.entry.enabled) return false

  const effective = getEffectiveHostingPolicy(resolved.domain, config)
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
