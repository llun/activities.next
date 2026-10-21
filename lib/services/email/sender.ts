import { getConfig } from '@/lib/config'
import type { Email } from '@/lib/config/email'
import type { Database } from '@/lib/database/types'
import { getDomainDisplayName } from '@/lib/services/domains/domainDisplayName'
import {
  type DomainIdentity,
  resolveDomainIdentity
} from '@/lib/services/domains/domainIdentity'
import { getServedLinkDomain } from '@/lib/services/domains/localDomains'

import type { EmailBrand } from './brand'

// The address inside `Name <a@b.c>`, or the whole value when it is bare.
const bareAddress = (value: string): string => {
  const match = value.match(/<([^<>]*)>\s*$/)
  return (match ? match[1] : value).trim()
}

// Only a served secondary domain (env or Admin › Domains) is branded. The
// primary, and any other source (a wildcard preview host, the DB-failure
// fallback), is the primary: its From and links stay as configured.
const isSecondary = (identity: DomainIdentity): boolean =>
  (identity.source === 'env' || identity.source === 'database') &&
  identity.domain !== getConfig().host

/**
 * The From of an email sent for `identity`'s domain. The primary keeps
 * ACTIVITIES_EMAIL_FROM exactly as configured. Any other domain sends from the
 * same mailbox (one verified sender, so SPF/DKIM keep passing) under its own
 * display name. Callers check `config.email` first.
 */
export const getEmailSender = (identity: DomainIdentity): Email => {
  const config = getConfig()
  const configured = config.email?.serviceFromAddress ?? ''
  if (!isSecondary(identity)) return configured
  const email = bareAddress(configured)
  // The name is sanitised again when the header is written (address.ts).
  return { name: getDomainDisplayName(identity), email }
}

// The primary leaves `domain` empty so its links and header host stay on
// `getBaseURL()` and `config.host` exactly as before (a configured host can
// carry a scheme, which the normalised domain does not).
export const toEmailBrand = (identity: DomainIdentity): EmailBrand => ({
  name: getDomainDisplayName(identity),
  domain: isSecondary(identity) ? identity.domain : ''
})

/**
 * Brand and sender for an email sent for `host`: the request host, or a
 * recipient actor's served domain (`getServedLinkDomain`); null or an unknown
 * host is the primary.
 */
export const resolveEmailIdentity = async (
  database: Database | null,
  host: string | null | undefined
): Promise<{ brand: EmailBrand; from: Email; contactEmail: string }> => {
  const identity = await resolveDomainIdentity(database, host)
  return {
    brand: toEmailBrand(identity),
    from: getEmailSender(identity),
    contactEmail: identity.contactEmail
  }
}

/**
 * The brand of mail to a local actor: their domain's name, when this server
 * serves that domain, else the primary's.
 */
export const resolveActorEmailBrand = async (
  database: Database | null,
  actor: { domain: string }
): Promise<EmailBrand> =>
  (await resolveEmailIdentity(database, getServedLinkDomain(actor.domain)))
    .brand
