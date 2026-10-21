import { Database } from '@/lib/database/types'
import {
  type FeatureFlags,
  applyDisabledFeatures
} from '@/lib/services/domains/domainFeatures'
import {
  getVisitedDomainIdentity,
  resolveDomainIdentity
} from '@/lib/services/domains/domainIdentity'
import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { headerHost } from '@/lib/services/guards/headerHost'

/**
 * The optional features on for the domain a page request arrived on, for
 * server components: the server's switches (Admin › Instance) minus what the
 * visited domain turned off (Admin › Domains). Nav and bootstrap only, like the
 * server switches: the routes keep working.
 */
export const getVisitedFeatures = async (
  serverFeatures: FeatureFlags
): Promise<FeatureFlags> => {
  const identity = await getVisitedDomainIdentity()
  return applyDisabledFeatures(serverFeatures, identity.disabledFeatures)
}

/** The same for an API request, from its own headers. */
export const getRequestFeatures = async (
  database: Database,
  headers: Headers,
  serverFeatures: FeatureFlags
): Promise<FeatureFlags> => {
  // Refresh first: `headerHost` trusts the visited host from the snapshot.
  await ensureServedDomainsFresh()
  const identity = await resolveDomainIdentity(database, headerHost(headers))
  return applyDisabledFeatures(serverFeatures, identity.disabledFeatures)
}
