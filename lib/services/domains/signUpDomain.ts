import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { normalizeServedDomainChoice } from '@/lib/utils/host'
import { logger } from '@/lib/utils/logger'
import { isEmailAllowed } from '@/lib/utils/normalizeEmail'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { getEnvDomainKind, getEnvDomains } from './adminDomains'
import { ensureServedDomainsFresh } from './servedDomainSnapshot'

/**
 * Who may sign up on the domain a request arrived on, and where the first
 * actor lives.
 *
 * - The primary domain (ACTIVITIES_HOST) uses the server's own
 *   `registrations.open` / `registrations.allowEmails`, as before.
 * - Any other served domain uses its Admin › Domains row: an
 *   ACTIVITIES_TRUSTED_HOSTS entry or an active row an admin added. Without a
 *   row, or with sign-ups off on it, sign-up on that domain is closed. There
 *   is no fallback to the primary: a visitor on run.example never ends up
 *   with a profile on social.example.
 * - Any other host (a wildcard-matched preview host, an untrusted Host that
 *   fell back) is closed unless it IS the primary.
 */
export type SignUpDomain = {
  // The normalised authority the first actor is created on.
  domain: string
  // What the sign-up page calls the domain: its name, else the domain.
  displayName: string
  source: 'primary' | 'env' | 'database' | 'other'
  open: boolean
  allowEmails: string[]
}

export const resolveSignUpDomain = async (
  database: Database,
  // The request's served host (`headerHost`), which is already trust-filtered.
  host: string | null | undefined
): Promise<SignUpDomain> => {
  await ensureServedDomainsFresh()
  const env = getEnvDomains()
  const primary = env.primary ?? getConfig().host
  const domain = normalizeServedDomainChoice(host) ?? primary
  const kind = getEnvDomainKind(domain, env)

  if (kind === 'primary') {
    const settings = await getResolvedServerSettings(database)
    return {
      domain,
      displayName: settings.instance.name || domain,
      source: 'primary',
      open: settings.registrations.open,
      allowEmails: settings.registrations.allowEmails
    }
  }

  const row = await database.getServedDomain({ domain })
  // An env domain's row only holds its sign-up settings (it is stored off);
  // a row an admin added counts only while it is on.
  const usable = row && (kind === 'env' || row.status === 'on')
  return {
    domain,
    displayName: row?.name || domain,
    source: kind === 'env' ? 'env' : row ? 'database' : 'other',
    open: Boolean(usable && row.signupsOpen),
    // An unreadable list leaves `open` false, so empty refuses everyone.
    allowEmails: (usable && row.allowedEmails) || []
  }
}

// A domain's own allowed-emails list. An empty list means anyone only while
// sign-ups are open there: a closed domain with no list (the default of a new
// row) lets nobody in on its own say-so.
const isEmailAllowedOnDomain = (
  allowEmails: string[],
  signupsOpen: boolean,
  email: string
): boolean =>
  allowEmails.length > 0 ? isEmailAllowed(allowEmails, email) : signupsOpen

/**
 * The allowed-emails gate for an existing account at sign-in: the server's
 * `registrations.allowEmails` as before, or the allowed emails of a domain one
 * of the account's profiles lives on, so a person who joined run.example under
 * its own list is not locked out by the primary's. An empty list on the domain
 * the account signed up on (`accounts.signUpDomain`, null for an account that
 * predates it and so signed up on the primary) lets it in even after sign-ups
 * close there, as closing sign-ups on the primary locks no member out; on any
 * other profile domain an empty list counts only while sign-ups are open. A
 * domain whose list cannot be read lets nobody in on its own say-so.
 */
export const isEmailAllowedForAccount = async (
  database: Database,
  email: string,
  accountId: string
): Promise<boolean> => {
  const settings = await getResolvedServerSettings(database)
  if (isEmailAllowed(settings.registrations.allowEmails, email)) return true

  const env = getEnvDomains()
  const account = await database.getAccountFromId({ id: accountId })
  if (!account) return false
  const signUpDomain = normalizeServedDomainChoice(account.signUpDomain)
  const actors = await database.getActorsForAccount({ accountId })
  const domains = [
    ...new Set(
      actors
        .map((actor) => normalizeServedDomainChoice(actor.domain))
        .filter((domain): domain is string => Boolean(domain))
        .filter((domain) => getEnvDomainKind(domain, env) !== 'primary')
    )
  ]
  for (const domain of domains) {
    const row = await database.getServedDomain({ domain })
    const usable =
      row && (getEnvDomainKind(domain, env) === 'env' || row.status === 'on')
    if (
      usable &&
      row.allowedEmails &&
      isEmailAllowedOnDomain(
        row.allowedEmails,
        row.signupsOpen || domain === signUpDomain,
        email
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * The allowed-emails gate for an account that has not confirmed yet changing
 * its address (`POST /api/v1/emails/confirmations`): only the list of the
 * domain it signed up on, `domain` (its actor's), as at sign-up. The primary
 * uses the server's `registrations.allowEmails` as before; any other domain
 * uses its own row, and is closed when that domain is no longer usable. The
 * server's list never stands in for another domain's here, or an empty primary
 * list would let a run.example sign-up swap in an address run.example refuses.
 */
export const isEmailAllowedForSignUpDomain = async (
  database: Database,
  email: string,
  domain: string
): Promise<boolean> => {
  if (!normalizeServedDomainChoice(domain)) return false
  const signUp = await resolveSignUpDomain(database, domain)
  if (signUp.source === 'primary') {
    return isEmailAllowed(signUp.allowEmails, email)
  }
  return isEmailAllowedOnDomain(signUp.allowEmails, signUp.open, email)
}

/**
 * `resolveSignUpDomain(...).open` for the public discovery documents
 * (`/api/v1/instance`, `/api/v2/instance`), which must not fail: null when
 * there is no database, or when the lookup fails on the primary, so the caller
 * can fall back to the server setting it already has. A failed lookup for any
 * other domain reports closed: the primary's setting says nothing about it.
 */
export const resolveSignUpOpenSafely = async (
  database: Database | null | undefined,
  host: string | null | undefined
): Promise<boolean | null> => {
  if (!database) return null
  try {
    return (await resolveSignUpDomain(database, host)).open
  } catch (error) {
    logger.error({
      message: 'Failed to resolve the sign-up domain',
      err: toLoggableError(error)
    })
    const env = getEnvDomains()
    const domain = normalizeServedDomainChoice(host) ?? env.primary ?? ''
    return getEnvDomainKind(domain, env) === 'primary' ? null : false
  }
}
