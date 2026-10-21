import type { DomainIdentity } from './domainIdentity'

/**
 * The name to show for a domain's identity: its name (Admin › Domains, else
 * Admin › Instance), or the domain itself when the name is blank, as NodeInfo
 * and the sign-up "Join" line do. Page titles, the web app manifest, the
 * sign-in heading, the landing, the passkey relying party name and the 2FA
 * issuer all use it.
 */
export const getDomainDisplayName = (
  identity: Pick<DomainIdentity, 'name' | 'domain'>
): string => identity.name.trim() || identity.domain
