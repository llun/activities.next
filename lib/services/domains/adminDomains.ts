import { type Config, getConfig } from '@/lib/config'
import type {
  DomainCheckResult,
  ServedDomainData
} from '@/lib/database/domains/servedDomain/types'
import { Database } from '@/lib/database/types'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import {
  getServedAuthority,
  normalizeServedDomainChoice
} from '@/lib/utils/host'

import type {
  AddDomainError,
  AdminDomain,
  AdminDomainList
} from './adminDomainTypes'
import { checkDomainReachability } from './domainCheck'
import { refreshServedDomainsAfterWrite } from './servedDomainSnapshot'

type EnvDomainConfig = Pick<Config, 'host' | 'trustedHosts'>

export type EnvDomains = {
  // ACTIVITIES_HOST, normalised; null only when it is not a plain authority.
  primary: string | null
  // The concrete ACTIVITIES_TRUSTED_HOSTS entries, normalised, primary excluded.
  trusted: string[]
  // The wildcard ACTIVITIES_TRUSTED_HOSTS entries, as written.
  wildcards: string[]
}

/** The domains the environment configures, split the way the admin page shows them. */
export const getEnvDomains = (
  config: EnvDomainConfig = getConfig()
): EnvDomains => {
  const primary = normalizeServedDomainChoice(config.host)
  const trusted: string[] = []
  const wildcards: string[] = []
  for (const raw of config.trustedHosts ?? []) {
    const rule = raw.trim()
    if (!rule) continue
    if (rule.includes('*')) {
      wildcards.push(rule)
      continue
    }
    const domain = normalizeServedDomainChoice(getServedAuthority(rule))
    if (domain && domain !== primary && !trusted.includes(domain)) {
      trusted.push(domain)
    }
  }
  return { primary, trusted, wildcards }
}

/** Whether a normalised domain is the primary, a concrete trusted host, or neither (null). */
export const getEnvDomainKind = (
  domain: string,
  env: EnvDomains = getEnvDomains()
): 'primary' | 'env' | null => {
  if (env.primary === domain) return 'primary'
  if (env.trusted.includes(domain)) return 'env'
  return null
}

const toAdminDomain = (
  row: ServedDomainData,
  source: AdminDomain['source'],
  profiles: number
): AdminDomain => ({
  domain: row.domain,
  source,
  name: row.name,
  // An env domain is on whatever its row says: trust comes from the env.
  status: source === 'database' ? row.status : 'on',
  profiles,
  signupsOpen: row.signupsOpen,
  // An unreadable list shows as empty; its sign-ups are already closed.
  allowedEmails: row.allowedEmails ?? [],
  allowExistingUsers: source === 'database' ? row.allowExistingUsers : true,
  lastCheckedAt: row.lastCheckedAt,
  lastCheck: row.lastCheckResult
})

const emptyRow = (domain: string): ServedDomainData => ({
  id: '',
  domain,
  status: 'off',
  name: null,
  signupsOpen: false,
  allowedEmails: [],
  allowExistingUsers: false,
  lastCheckedAt: null,
  lastCheckStatus: null,
  lastCheckResult: null,
  createdAt: 0,
  updatedAt: 0
})

/** Every domain for the list page: the primary, the env domains, the rows, the wildcards. */
export const getAdminDomainList = async (
  database: Database
): Promise<AdminDomainList> => {
  const env = getEnvDomains()
  const [rows, settings] = await Promise.all([
    database.getServedDomains(),
    getResolvedServerSettings(database)
  ])
  const rowsByDomain = new Map(rows.map((row) => [row.domain, row]))
  const allDomains = [
    ...(env.primary ? [env.primary] : []),
    ...env.trusted,
    ...rows
      .map((row) => row.domain)
      .filter(
        (domain) => domain !== env.primary && !env.trusted.includes(domain)
      )
  ]
  const counts = await database.countLocalActorsByDomain({
    domains: allDomains
  })

  const domains: AdminDomain[] = []
  if (env.primary) {
    domains.push({
      ...toAdminDomain(emptyRow(env.primary), 'primary', 0),
      name: settings.instance.name || null,
      profiles: counts[env.primary] ?? 0,
      signupsOpen: settings.registrations.open,
      allowedEmails: settings.registrations.allowEmails
    })
  }
  for (const domain of env.trusted) {
    domains.push(
      toAdminDomain(
        rowsByDomain.get(domain) ?? emptyRow(domain),
        'env',
        counts[domain] ?? 0
      )
    )
  }
  for (const row of rows) {
    if (getEnvDomainKind(row.domain, env)) continue
    domains.push(toAdminDomain(row, 'database', counts[row.domain] ?? 0))
  }

  return {
    domains,
    wildcards: env.wildcards.map((rule) => ({ rule }))
  }
}

/** One domain's page; null when the domain is neither in the env nor a row. */
export const getAdminDomain = async (
  database: Database,
  domain: string
): Promise<AdminDomain | null> => {
  const normalized = normalizeServedDomainChoice(domain)
  if (!normalized) return null
  const { domains } = await getAdminDomainList(database)
  return domains.find((item) => item.domain === normalized) ?? null
}

export type AddDomainResult =
  | { type: 'added'; domain: AdminDomain }
  | { type: 'error'; error: AddDomainError }

const getKnownHosts = (env: EnvDomains) => [
  ...(env.primary ? [env.primary] : []),
  ...env.trusted
]

const runCheck = (domain: string, env: EnvDomains) =>
  checkDomainReachability({ domain, knownHosts: getKnownHosts(env) })

/** Normalises and validates `rawDomain`, runs the check and saves it as off. */
export const addDomain = async (
  database: Database,
  rawDomain: string,
  check: (domain: string) => Promise<DomainCheckResult> = (domain) =>
    runCheck(domain, getEnvDomains())
): Promise<AddDomainResult> => {
  if (rawDomain.includes('*')) return { type: 'error', error: 'wildcard' }
  const domain = normalizeServedDomainChoice(rawDomain)
  if (!domain) return { type: 'error', error: 'invalid' }
  const env = getEnvDomains()
  const kind = getEnvDomainKind(domain, env)
  if (kind) return { type: 'error', error: kind }
  if (await database.getServedDomain({ domain })) {
    return { type: 'error', error: 'exists' }
  }

  const result = await check(domain)
  try {
    const row = await database.createServedDomain({
      domain,
      status: 'off',
      check: result
    })
    return { type: 'added', domain: toAdminDomain(row, 'database', 0) }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { type: 'error', error: 'exists' }
    }
    throw error
  }
}

/** Check again. Null for a domain without a row or an env domain. */
export const recheckDomain = async (
  database: Database,
  domain: string,
  check: (domain: string) => Promise<DomainCheckResult> = (target) =>
    runCheck(target, getEnvDomains())
): Promise<AdminDomain | null> => {
  if (getEnvDomainKind(domain)) return null
  const existing = await database.getServedDomain({ domain })
  if (!existing) return null
  const result = await check(domain)
  // A domain that no longer passes stays as it is: turning it off is the
  // admin's call, made in the Turn off box.
  const row = await database.updateServedDomain({ domain, check: result })
  if (!row) return null
  return getAdminDomain(database, row.domain)
}

export type SetDomainStatusResult =
  | { type: 'updated'; domain: AdminDomain }
  | { type: 'not-found' }
  | { type: 'locked' }
  | { type: 'check-failed'; domain: AdminDomain }

/**
 * Turns a database domain on or off. Turning on runs the check again and only
 * turns the domain on when it passes, so a stale "passed" cannot put a domain
 * that has since moved away back into trust.
 */
export const setDomainStatus = async (
  database: Database,
  domain: string,
  status: 'on' | 'off',
  check: (domain: string) => Promise<DomainCheckResult> = (target) =>
    runCheck(target, getEnvDomains())
): Promise<SetDomainStatusResult> => {
  if (getEnvDomainKind(domain)) return { type: 'locked' }
  const existing = await database.getServedDomain({ domain })
  if (!existing) return { type: 'not-found' }

  if (status === 'on') {
    const result = await check(domain)
    if (!result.passed) {
      await database.updateServedDomain({ domain, check: result })
      await refreshServedDomainsAfterWrite(database)
      const current = await getAdminDomain(database, domain)
      return current
        ? { type: 'check-failed', domain: current }
        : { type: 'not-found' }
    }
    await database.updateServedDomain({ domain, status: 'on', check: result })
  } else {
    await database.updateServedDomain({ domain, status: 'off' })
  }
  await refreshServedDomainsAfterWrite(database)
  const updated = await getAdminDomain(database, domain)
  return updated ? { type: 'updated', domain: updated } : { type: 'not-found' }
}

export type RegistrationSettings = {
  signupsOpen?: boolean
  allowedEmails?: string[]
  allowExistingUsers?: boolean
}

export type UpdateRegistrationsResult =
  | { type: 'updated'; domain: AdminDomain }
  | { type: 'not-found' }
  | { type: 'primary' }

/**
 * Saves a domain's Registrations box. A concrete env domain gets a row the
 * first time (stored off: its trust comes from the env, never from the row).
 * The primary's settings are Admin › Instance.
 */
export const updateDomainRegistrations = async (
  database: Database,
  domain: string,
  settings: RegistrationSettings
): Promise<UpdateRegistrationsResult> => {
  const kind = getEnvDomainKind(domain)
  if (kind === 'primary') return { type: 'primary' }
  const existing = await database.getServedDomain({ domain })
  if (!existing && kind !== 'env') return { type: 'not-found' }

  const values = {
    ...(settings.signupsOpen !== undefined
      ? { signupsOpen: settings.signupsOpen }
      : null),
    ...(settings.allowedEmails !== undefined
      ? { allowedEmails: settings.allowedEmails }
      : null),
    // Env domains always let existing users add profiles.
    ...(settings.allowExistingUsers !== undefined && kind !== 'env'
      ? { allowExistingUsers: settings.allowExistingUsers }
      : null)
  }
  if (existing) {
    await database.updateServedDomain({ domain, ...values })
  } else {
    try {
      await database.createServedDomain({ domain, status: 'off', ...values })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      await database.updateServedDomain({ domain, ...values })
    }
  }
  const updated = await getAdminDomain(database, domain)
  return updated ? { type: 'updated', domain: updated } : { type: 'not-found' }
}

export type RemoveDomainResult =
  | { type: 'removed' }
  | { type: 'not-found' }
  | { type: 'locked' }
  | { type: 'on' }
  | { type: 'has-profiles' }

/** Removes a database domain that is off and has no profiles. */
export const removeDomain = async (
  database: Database,
  domain: string
): Promise<RemoveDomainResult> => {
  if (getEnvDomainKind(domain)) return { type: 'locked' }
  const existing = await database.getServedDomain({ domain })
  if (!existing) return { type: 'not-found' }
  if (existing.status === 'on') return { type: 'on' }
  const counts = await database.countLocalActorsByDomain({ domains: [domain] })
  if ((counts[domain] ?? 0) > 0) return { type: 'has-profiles' }
  await database.deleteServedDomain({ domain })
  await refreshServedDomainsAfterWrite(database)
  return { type: 'removed' }
}
