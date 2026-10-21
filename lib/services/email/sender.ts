import { getConfig } from '@/lib/config'
import type { Email } from '@/lib/config/email'
import type { Database } from '@/lib/database/types'
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

/**
 * The From of an email sent for `identity`'s domain. The primary keeps
 * ACTIVITIES_EMAIL_FROM exactly as configured. Any other domain sends from the
 * same mailbox (one verified sender, so SPF/DKIM keep passing) under its own
 * display name. Callers check `config.email` first.
 */
export const getEmailSender = (identity: DomainIdentity): Email => {
  const config = getConfig()
  const configured = config.email?.serviceFromAddress ?? ''
  if (identity.source === 'primary' || identity.domain === config.host) {
    return configured
  }
  const email = bareAddress(configured)
  // The name is sanitised again when the header is written (address.ts); an
  // empty one sends the bare address.
  return identity.name.trim() ? { name: identity.name, email } : email
}

export const toEmailBrand = (identity: DomainIdentity): EmailBrand => ({
  name: identity.name,
  domain: identity.domain
})

/**
 * Brand and sender for an email sent for `host`: the request host, or a
 * recipient actor's served domain (`getServedLinkDomain`); null or an unknown
 * host is the primary.
 */
export const resolveEmailIdentity = async (
  database: Database | null,
  host: string | null | undefined
): Promise<{ brand: EmailBrand; from: Email }> => {
  const identity = await resolveDomainIdentity(database, host)
  return { brand: toEmailBrand(identity), from: getEmailSender(identity) }
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
