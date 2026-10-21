import { Database } from '@/lib/database/types'
import {
  type DomainIdentity,
  resolveDomainIdentity
} from '@/lib/services/domains/domainIdentity'
import type { InstanceRuleData } from '@/lib/types/database/operations'

/**
 * Which domain-scoped rules and announcements a visit sees (step 5 of the
 * multi-domain plan). `host` must come from `headerHost` (trust-filtered).
 *
 * - Rules: the server rules (domain null), then the visited domain's own. Only
 *   an env domain or an active added domain has own rules; the primary has
 *   none (its rules are the server rules), and neither does a wildcard
 *   preview host or an off domain (which resolves to the primary).
 * - Announcements: every-domain ones plus the visited domain's, the primary
 *   included, since an announcement may be for the primary alone.
 */
export const rulesDomainOf = (identity: DomainIdentity): string | null =>
  identity.source === 'env' || identity.source === 'database'
    ? identity.domain
    : null

export const announcementsDomainOf = (
  identity: DomainIdentity
): string | null => (identity.source === 'other' ? null : identity.domain)

/** The rules visible on `host`: server rules, then the domain's own. */
export const getRulesForHost = async (
  database: Database,
  host: string | null | undefined
): Promise<InstanceRuleData[]> => {
  const identity = await resolveDomainIdentity(database, host)
  return database.getInstanceRules({ domain: rulesDomainOf(identity) })
}

/** The domain whose announcements `host` shows besides the every-domain ones. */
export const getAnnouncementsDomainForHost = async (
  database: Database,
  host: string | null | undefined
): Promise<string | null> =>
  announcementsDomainOf(await resolveDomainIdentity(database, host))
