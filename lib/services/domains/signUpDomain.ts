import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { normalizeServedDomainChoice } from '@/lib/utils/host'
import { isEmailAllowed } from '@/lib/utils/normalizeEmail'

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
    allowEmails: usable ? row.allowedEmails : []
  }
}

/**
 * The allowed-emails gate for an existing account (sign-in, changing the
 * address): the server's `registrations.allowEmails` as before, or the allowed
 * emails of a domain one of the account's profiles lives on, so a person who
 * joined run.example under its own list is not locked out by the primary's.
 */
export const isEmailAllowedForAccount = async (
  database: Database,
  email: string,
  accountId: string
): Promise<boolean> => {
  const settings = await getResolvedServerSettings(database)
  if (isEmailAllowed(settings.registrations.allowEmails, email)) return true

  const env = getEnvDomains()
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
    if (usable && isEmailAllowed(row.allowedEmails, email)) return true
  }
  return false
}

/**
 * `resolveSignUpDomain(...).open` for the public discovery documents
 * (`/api/v1/instance`, `/api/v2/instance`), which must not fail: null when
 * there is no database or the lookup fails, so the caller can fall back to the
 * server setting it already has.
 */
export const resolveSignUpOpenSafely = async (
  database: Database | null | undefined,
  host: string | null | undefined
): Promise<boolean | null> => {
  if (!database) return null
  try {
    return (await resolveSignUpDomain(database, host)).open
  } catch {
    return null
  }
}
