import type { ServedDomainWithPoliciesData } from '@/lib/database/domains/servedDomain/types'
import { Database } from '@/lib/database/types'

/**
 * A served domain's own identity and policy overrides, as stored on its
 * Admin › Domains row. Null in a field means "Same as server". The disabled
 * features ride along: they come from the same row and are invalidated by the
 * same admin writes.
 */
export type DomainOverrides = Pick<
  ServedDomainWithPoliciesData,
  | 'name'
  | 'description'
  | 'contactEmail'
  | 'termsOfService'
  | 'termsOfServiceUpdatedAt'
  | 'privacyPolicy'
  | 'privacyPolicyUpdatedAt'
  | 'disabledFeatures'
>

// Short, like the server settings cache: an admin's own write invalidates at
// once, other instances converge within one TTL.
export const DOMAIN_IDENTITY_CACHE_TTL_MS = 15_000
// Only served domains (env domains and active rows) get a slot, so this is a
// guard against a long env list, not a working limit.
export const DOMAIN_IDENTITY_CACHE_MAX_ENTRIES = 64

type CacheEntry = {
  // Null when the domain has no usable row: it uses the server identity.
  overrides: DomainOverrides | null
  expiresAt: number
  epoch: number
}

// Next bundles route handlers and server components as separate module graphs,
// so the admin API route that saves a domain holds a different copy of this
// cache than the policy pages. Every invalidation also bumps one process-wide
// epoch on globalThis, which all copies check before serving an entry (the
// same sharing as the server settings cache).
const EPOCH_KEY = Symbol.for('activities.next.domainIdentity.epoch')
const globalEpoch = globalThis as typeof globalThis & {
  [EPOCH_KEY]?: number
}
const currentEpoch = (): number => globalEpoch[EPOCH_KEY] ?? 0

const cacheByDatabase = new WeakMap<Database, Map<string, CacheEntry>>()

const toOverrides = (row: ServedDomainWithPoliciesData): DomainOverrides => ({
  name: row.name,
  description: row.description,
  contactEmail: row.contactEmail,
  termsOfService: row.termsOfService,
  termsOfServiceUpdatedAt: row.termsOfServiceUpdatedAt,
  privacyPolicy: row.privacyPolicy,
  privacyPolicyUpdatedAt: row.privacyPolicyUpdatedAt,
  disabledFeatures: row.disabledFeatures
})

const remember = (
  database: Database,
  domain: string,
  entry: CacheEntry
): void => {
  let entries = cacheByDatabase.get(database)
  if (!entries) {
    entries = new Map()
    cacheByDatabase.set(database, entries)
  }
  entries.delete(domain)
  if (entries.size >= DOMAIN_IDENTITY_CACHE_MAX_ENTRIES) {
    const now = Date.now()
    for (const [key, value] of entries) {
      if (value.expiresAt <= now || value.epoch !== currentEpoch()) {
        entries.delete(key)
      }
    }
    // Still full: drop the oldest (a Map iterates in insertion order).
    while (entries.size >= DOMAIN_IDENTITY_CACHE_MAX_ENTRIES) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }
  entries.set(domain, entry)
}

/**
 * The overrides of served domain `domain`, or null when its row is not usable
 * (none, or an added domain that is off). An env domain's row counts whatever
 * its status (trust comes from the env), an added domain's only while it is
 * on: the same rule as `resolveSignUpDomain`. Cached per database for
 * `DOMAIN_IDENTITY_CACHE_TTL_MS`. Throws when the read fails (nothing is
 * cached then); the caller falls back to the server identity.
 */
export const readDomainOverrides = async (
  database: Database,
  domain: string,
  kind: 'env' | 'database'
): Promise<DomainOverrides | null> => {
  const now = Date.now()
  // Read before the await: an invalidation during the read leaves the entry
  // written under this older epoch, so the next call reads again.
  const epoch = currentEpoch()
  const cached = cacheByDatabase.get(database)?.get(domain)
  if (cached && cached.epoch === epoch && cached.expiresAt > now) {
    return cached.overrides
  }

  const row = await database.getServedDomainWithPolicies({ domain })
  const usable = row && (kind === 'env' || row.status === 'on')
  const overrides = usable ? toOverrides(row) : null
  remember(database, domain, {
    overrides,
    expiresAt: now + DOMAIN_IDENTITY_CACHE_TTL_MS,
    epoch
  })
  return overrides
}

/**
 * Drops cached domain overrides so the next read sees an admin's change: the
 * given database's entries in this module copy, and every copy's entries
 * through the shared epoch.
 */
export const invalidateDomainIdentityCache = (
  database?: Database | null
): void => {
  if (database) cacheByDatabase.delete(database)
  globalEpoch[EPOCH_KEY] = currentEpoch() + 1
}
