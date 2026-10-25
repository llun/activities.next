import { Database } from '@/lib/database/types'
import { normalizeServedDomainChoice } from '@/lib/utils/host'

import { getEnvDomainKind, getEnvDomains } from './adminDomains'

/**
 * The domain an admin names for a rule or an announcement (the `domain` field
 * or query parameter of the admin APIs). Null stands for "every domain":
 * server rules, and announcements for all domains.
 */
export type AdminDomainScope =
  | { type: 'ok'; domain: string | null }
  // Not a domain name.
  | { type: 'invalid' }
  // A well-formed domain that is neither the primary, an env domain nor a row
  // of Admin › Served domains.
  | { type: 'unknown' }
  // The primary domain, for a scope that does not take it (it has no own
  // rules: its rules are the server rules).
  | { type: 'primary' }

export const ADMIN_DOMAIN_SCOPE_MESSAGES = {
  invalid: 'Enter a domain name, such as photos.example.',
  unknown: 'That is not a domain this server serves.',
  primary:
    'The primary domain has no rules of its own; its rules are the server rules.'
} as const

/**
 * Validates `raw` as the scope of a rule or an announcement. A served domain is
 * the primary host, a concrete `ACTIVITIES_TRUSTED_HOSTS` entry or a row of
 * Admin › Served domains (on or off: an admin may prepare an off domain). Blank or
 * null is "every domain". `allowPrimary` is false for rules (the primary has
 * none of its own) and true for announcements (a primary-only announcement is
 * a valid audience).
 */
export const resolveAdminDomainScope = async (
  database: Database,
  raw: string | null | undefined,
  { allowPrimary }: { allowPrimary: boolean }
): Promise<AdminDomainScope> => {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { type: 'ok', domain: null }
  }
  const domain = normalizeServedDomainChoice(raw)
  if (!domain) return { type: 'invalid' }
  const kind = getEnvDomainKind(domain, getEnvDomains())
  if (kind === 'primary') {
    return allowPrimary ? { type: 'ok', domain } : { type: 'primary' }
  }
  if (kind === 'env') return { type: 'ok', domain }
  if (await database.getServedDomain({ domain })) return { type: 'ok', domain }
  return { type: 'unknown' }
}

/** The error body an admin API answers a refused scope with (HTTP 422). */
export const domainScopeErrorBody = (
  type: 'invalid' | 'unknown' | 'primary'
) => ({ error: ADMIN_DOMAIN_SCOPE_MESSAGES[type], code: type })
