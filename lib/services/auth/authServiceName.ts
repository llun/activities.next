import { Database } from '@/lib/database/types'
import { getDomainDisplayName } from '@/lib/services/domains/domainDisplayName'
import { resolveDomainIdentity } from '@/lib/services/domains/domainIdentity'

/**
 * The name better-auth shows for the domain of `baseURL` (from
 * `resolveAuthBaseURL`, so already trust-filtered): the passkey relying party
 * name and the 2FA issuer. It is that domain's identity name, so a passkey
 * saved on a served domain is labelled with the name visitors there see.
 */
export const resolveAuthServiceName = async (
  database: Database | null,
  baseURL: string
): Promise<string> =>
  getDomainDisplayName(
    await resolveDomainIdentity(database, new URL(baseURL).host)
  )
