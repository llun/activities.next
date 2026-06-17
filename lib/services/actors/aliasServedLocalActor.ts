import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import {
  getTrustedHostRules,
  isHostTrustedByRules,
  normalizeHost
} from '@/lib/utils/host'

interface AliasServedLocalActorParams {
  // Only the username lookup is needed; accept any database-shaped object that
  // provides it so web-UI callers holding a `Pick<Database, …>` can reuse this.
  database: Pick<Database, 'getActorFromUsername'>
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

  // Look for the canonical local actor under the hosts this instance serves as.
  // Seed the dedupe set with the EXACT domain the caller already strict-looked-up
  // (which may be mixed-case) rather than its normalized form, so a mixed-case
  // query such as `Alias.Example` still tries the normalized `alias.example` the
  // caller never attempted. Drop wildcards (which cannot be a concrete lookup
  // domain). Actor `domain` columns are matched case-sensitively on
  // PostgreSQL/SQLite, so — mirroring the WebFinger strict-lookup convention —
  // also query the as-configured casing whenever a rule is a pure-case variant
  // of its normalized form (e.g. `MyInstance.com` vs `myinstance.com`).
  const seen = new Set([domain])
  const lookupHosts: string[] = []
  for (const rule of servedRules) {
    const hostPart = rule.split(',')[0]?.trim() ?? ''
    const servedHost = normalizeHost(hostPart, { allowWildcard: false })
    if (!servedHost) continue

    // Each rule contributes its normalized host and — when the rule is a
    // pure-case variant — its as-configured casing. Filter each variant against
    // `seen` independently: a rule whose normalized form equals the queried
    // domain must still contribute its mixed-case variant (and vice versa),
    // since the caller only tried the exact `domain` string.
    const variants = [servedHost]
    if (hostPart !== servedHost && hostPart.toLowerCase() === servedHost) {
      variants.push(hostPart)
    }
    for (const variant of variants) {
      if (seen.has(variant)) continue
      seen.add(variant)
      lookupHosts.push(variant)
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
