import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import {
  getTrustedHostRules,
  isHostTrustedByRules,
  normalizeHost
} from '@/lib/utils/host'

interface AliasServedLocalActorParams {
  database: Database
  username: string
  domain: string
}

type ServedActor = Awaited<ReturnType<Database['getActorFromUsername']>>

/**
 * Resolve `username@domain` to the canonical local actor when `domain` is a host
 * this instance serves as (its configured ACTIVITIES_HOST or one of
 * ACTIVITIES_TRUSTED_HOSTS) but no actor is stored under that exact domain.
 *
 * This completes the trusted-host feature for account resolution: a deployment
 * reached under multiple hostnames (e.g. a CloudFront alias) keeps every actor
 * on one canonical domain, yet clients legitimately address the local account
 * using whichever host they connected to. Without this, WebFinger / search /
 * lookup of `user@<alias-host>` 404 because the lookup keys strictly on the
 * stored domain.
 *
 * The returned row is the EXISTING canonical actor (its id/domain are
 * unchanged), so federation identity, HTTP-Signature key ids, and acct/url stay
 * canonical.
 *
 * Intended as an alias-ONLY fallback: callers run their normal strict lookup
 * first and only invoke this on a miss. Returns null when the domain is not
 * served by this instance, when no local actor owns the username on a served
 * host, or when the username is ambiguous across multiple served local domains.
 */
export const aliasServedLocalActor = async ({
  database,
  username,
  domain
}: AliasServedLocalActorParams): Promise<ServedActor> => {
  const queriedHost = normalizeHost(domain, { allowWildcard: false })
  if (!queriedHost) return null

  const servedRules = getTrustedHostRules(getConfig())
  if (!isHostTrustedByRules(queriedHost, servedRules)) return null

  // The caller already missed on the queried domain, so skip it and look for the
  // canonical local actor under the OTHER hosts this instance serves as. Drop
  // wildcards (which cannot be a concrete lookup domain) and dedupe by the
  // normalized host. Actor `domain` columns are matched case-sensitively on
  // PostgreSQL/SQLite, so — mirroring the WebFinger strict-lookup convention —
  // also query the as-configured casing whenever a rule is a pure-case variant
  // of its normalized form (e.g. `MyInstance.com` vs `myinstance.com`).
  const seen = new Set([queriedHost])
  const lookupHosts: string[] = []
  for (const rule of servedRules) {
    const servedHost = normalizeHost(rule, { allowWildcard: false })
    if (!servedHost || seen.has(servedHost)) continue
    seen.add(servedHost)
    lookupHosts.push(servedHost)

    const configuredHost = rule.split(',')[0]?.trim() ?? ''
    if (
      configuredHost &&
      configuredHost !== servedHost &&
      configuredHost.toLowerCase() === servedHost &&
      !seen.has(configuredHost)
    ) {
      seen.add(configuredHost)
      lookupHosts.push(configuredHost)
    }
  }

  // The queried host is the only host this instance serves as — nothing to
  // alias to.
  if (lookupHosts.length === 0) return null

  const candidates = await Promise.all(
    lookupHosts.map((lookupHost) =>
      database.getActorFromUsername({ username, domain: lookupHost })
    )
  )
  // Only a local actor (one that owns a private key) may be aliased to, and
  // dedupe by actor id so that querying multiple casing variants of the same
  // host (or a case-insensitive backend) cannot register as false ambiguity.
  const matches = Array.from(
    new Map(
      candidates
        .filter((candidate): candidate is NonNullable<ServedActor> =>
          Boolean(candidate?.privateKey)
        )
        .map((candidate) => [candidate.id, candidate])
    ).values()
  )

  // Alias only when exactly one served host owns this username's local actor;
  // any other count is ambiguous and must not be guessed.
  return matches.length === 1 ? matches[0] : null
}
