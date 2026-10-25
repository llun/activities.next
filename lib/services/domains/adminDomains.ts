import { type Config, getConfig } from '@/lib/config'
import type {
  DomainCheckResult,
  ServedDomainData,
  UpdateServedDomainParams
} from '@/lib/database/domains/servedDomain/types'
import { Database } from '@/lib/database/types'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'
import {
  getInstanceContactAccount,
  getInstanceContactEmail
} from '@/lib/services/mastodon/instance'
import {
  getResolvedServerSettings,
  getServerSettingsView
} from '@/lib/services/serverSettings'
import {
  getServedAuthority,
  normalizeServedDomainChoice
} from '@/lib/utils/host'

import type {
  AddDomainError,
  AdminDomain,
  AdminDomainDetail,
  AdminDomainList,
  AdminDomainSettingsPatch,
  ServerIdentityView
} from './adminDomainTypes'
import { checkDomainReachability } from './domainCheck'
import { invalidateDomainIdentityCache } from './domainIdentityCache'
import { refreshServedDomainsAfterWrite } from './servedDomainSnapshot'

type EnvDomainConfig = Pick<Config, 'host' | 'trustedHosts'>

export type EnvDomains = {
  // ACTIVITIES_HOST, normalised as a trusted host is; null when it names none.
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
  const primary = normalizeServedDomainChoice(getServedAuthority(config.host))
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
  description: null,
  contactEmail: null,
  disabledFeatures: [],
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

/**
 * One domain's page, with its own identity and policies; null when the domain
 * is neither in the env nor a row. On the primary, description, contact email
 * and policies are null (it uses the server's, Admin › Server settings); its name
 * mirrors the server's name.
 */
export const getAdminDomain = async (
  database: Database,
  domain: string
): Promise<AdminDomainDetail | null> => {
  const normalized = normalizeServedDomainChoice(domain)
  if (!normalized) return null
  const { domains } = await getAdminDomainList(database)
  const item = domains.find((entry) => entry.domain === normalized)
  if (!item) return null
  const row =
    item.source === 'primary'
      ? null
      : await database.getServedDomainWithPolicies({ domain: normalized })
  return {
    ...item,
    description: row?.description ?? null,
    contactEmail: row?.contactEmail ?? null,
    termsOfService: row?.termsOfService ?? null,
    privacyPolicy: row?.privacyPolicy ?? null,
    termsOfServiceUpdatedAt: row?.termsOfServiceUpdatedAt ?? null,
    privacyPolicyUpdatedAt: row?.privacyPolicyUpdatedAt ?? null,
    disabledFeatures: row?.disabledFeatures ?? []
  }
}

/**
 * The server's identity as a domain page shows it beside "Same as server":
 * Admin › Server settings' resolved values, and whether the server has terms and a
 * privacy policy (never their text).
 */
export const getServerIdentityView = async (
  database: Database
): Promise<ServerIdentityView> => {
  const [view, contactAccount] = await Promise.all([
    getServerSettingsView(database),
    getInstanceContactAccount(database)
  ])
  const { instance, policies } = view.settings
  return {
    name: instance.name,
    description: instance.description,
    // What the instance API serves when no contact email is set.
    contactEmail: instance.contactEmail || getInstanceContactEmail(getConfig()),
    contactAccount: contactAccount ? `@${contactAccount.acct}` : null,
    terms: {
      set: policies.termsOfService.trim() !== '',
      updatedAt: view.updatedAt['policies.termsOfService'] ?? null
    },
    privacy: {
      set: policies.privacyPolicy.trim() !== '',
      updatedAt: view.updatedAt['policies.privacyPolicy'] ?? null
    }
  }
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
): Promise<AdminDomainDetail | null> => {
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
  | { type: 'updated'; domain: AdminDomainDetail }
  | { type: 'not-found' }
  | { type: 'locked' }
  | { type: 'check-failed'; domain: AdminDomainDetail }

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
  // An off domain falls back to the server identity at once here.
  invalidateDomainIdentityCache(database)
  const updated = await getAdminDomain(database, domain)
  return updated ? { type: 'updated', domain: updated } : { type: 'not-found' }
}

export type UpdateDomainSettingsResult =
  | { type: 'updated'; domain: AdminDomainDetail }
  | { type: 'not-found' }
  | { type: 'primary' }

type PolicyValues = Pick<
  UpdateServedDomainParams,
  | 'termsOfService'
  | 'termsOfServiceUpdatedAt'
  | 'privacyPolicy'
  | 'privacyPolicyUpdatedAt'
>

// The text and date to store for one policy: the date moves to now only when
// the text really changed, and is cleared with the text.
const policyValues = (
  key: 'termsOfService' | 'privacyPolicy',
  next: string | null | undefined,
  current: string | null,
  now: number
): PolicyValues => {
  if (next === undefined || next === current) return {}
  const updatedAt = next === null ? null : now
  return key === 'termsOfService'
    ? { termsOfService: next, termsOfServiceUpdatedAt: updatedAt }
    : { privacyPolicy: next, privacyPolicyUpdatedAt: updatedAt }
}

/**
 * Saves a domain's Registrations, Identity or Policies box: whatever `patch`
 * carries, the rest stays. Null on an identity or policy field means "Same as
 * server". A concrete env domain gets a row the first time (stored off: its
 * trust comes from the env, never from the row). The primary's settings are
 * Admin › Server settings.
 */
export const updateDomainSettings = async (
  database: Database,
  domain: string,
  patch: AdminDomainSettingsPatch
): Promise<UpdateDomainSettingsResult> => {
  const kind = getEnvDomainKind(domain)
  if (kind === 'primary') return { type: 'primary' }
  const existing = await database.getServedDomainWithPolicies({ domain })
  if (!existing && kind !== 'env') return { type: 'not-found' }

  const now = Date.now()
  const values = {
    ...(patch.signupsOpen !== undefined
      ? { signupsOpen: patch.signupsOpen }
      : null),
    ...(patch.allowedEmails !== undefined
      ? { allowedEmails: patch.allowedEmails }
      : null),
    // Env domains always let existing users add profiles.
    ...(patch.allowExistingUsers !== undefined && kind !== 'env'
      ? { allowExistingUsers: patch.allowExistingUsers }
      : null),
    ...(patch.name !== undefined ? { name: patch.name } : null),
    ...(patch.description !== undefined
      ? { description: patch.description }
      : null),
    ...(patch.contactEmail !== undefined
      ? { contactEmail: patch.contactEmail }
      : null),
    ...(patch.disabledFeatures !== undefined
      ? { disabledFeatures: patch.disabledFeatures }
      : null),
    ...policyValues(
      'termsOfService',
      patch.termsOfService,
      existing?.termsOfService ?? null,
      now
    ),
    ...policyValues(
      'privacyPolicy',
      patch.privacyPolicy,
      existing?.privacyPolicy ?? null,
      now
    )
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
  // Identity writes change no trust, so the snapshot needs no refresh.
  invalidateDomainIdentityCache(database)
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
  // The domain's own rules and announcements go with it, in one transaction;
  // nothing could show them any more.
  await database.deleteServedDomainWithScopes({ domain })
  await refreshServedDomainsAfterWrite(database)
  invalidateDomainIdentityCache(database)
  return { type: 'removed' }
}
