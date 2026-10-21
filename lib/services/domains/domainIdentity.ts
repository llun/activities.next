import { headers } from 'next/headers'
import { cache } from 'react'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { headerHost } from '@/lib/services/guards/headerHost'
import {
  type ServerSettingsView,
  getServerSettingsView
} from '@/lib/services/serverSettings'
import { normalizeServedDomainChoice } from '@/lib/utils/host'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { getEnvDomainKind, getEnvDomains } from './adminDomains'
import {
  type DomainOverrides,
  readDomainOverrides
} from './domainIdentityCache'
import {
  ensureServedDomainsFresh,
  getActiveServedDomainNames
} from './servedDomainSnapshot'

/**
 * A terms of service or privacy policy, as the Markdown an admin wrote.
 * `updatedAt` is when it last changed (epoch ms), null when it comes from the
 * environment (an env pin has no date). `source` says whether the visited
 * domain set its own or uses the server's.
 */
export type PolicyDocument = {
  markdown: string
  updatedAt: number | null
  source: 'domain' | 'server'
}

/**
 * What a visitor to one served domain sees as "this server": its name,
 * description, contact email and policies. Every field falls back to the
 * server's own setting (Admin › Instance) when the domain sets none.
 */
export type DomainIdentity = {
  // The normalised visited domain; the primary when the host names none.
  domain: string
  source: 'primary' | 'env' | 'database' | 'other'
  name: string
  description: string
  // '' when there is none.
  contactEmail: string
  // null when no document is set (blank counts as none).
  termsOfService: PolicyDocument | null
  privacyPolicy: PolicyDocument | null
}

const serverPolicy = (
  view: ServerSettingsView,
  key: 'policies.termsOfService' | 'policies.privacyPolicy',
  markdown: string
): PolicyDocument | null =>
  markdown.trim()
    ? { markdown, updatedAt: view.updatedAt[key] ?? null, source: 'server' }
    : null

const serverIdentity = (
  view: ServerSettingsView,
  domain: string,
  source: DomainIdentity['source']
): DomainIdentity => ({
  domain,
  source,
  name: view.settings.instance.name,
  description: view.settings.instance.description,
  contactEmail: view.settings.instance.contactEmail,
  termsOfService: serverPolicy(
    view,
    'policies.termsOfService',
    view.settings.policies.termsOfService
  ),
  privacyPolicy: serverPolicy(
    view,
    'policies.privacyPolicy',
    view.settings.policies.privacyPolicy
  )
})

// A domain's own policy wins while it has text; otherwise the server's.
const domainPolicy = (
  markdown: string | null,
  updatedAt: number | null,
  fallback: PolicyDocument | null
): PolicyDocument | null =>
  markdown?.trim() ? { markdown, updatedAt, source: 'domain' } : fallback

// Per field: the domain's own value when it sets one, else the server's.
const applyOverrides = (
  identity: DomainIdentity,
  overrides: DomainOverrides
): DomainIdentity => ({
  ...identity,
  name: overrides.name || identity.name,
  description: overrides.description || identity.description,
  contactEmail: overrides.contactEmail || identity.contactEmail,
  termsOfService: domainPolicy(
    overrides.termsOfService,
    overrides.termsOfServiceUpdatedAt,
    identity.termsOfService
  ),
  privacyPolicy: domainPolicy(
    overrides.privacyPolicy,
    overrides.privacyPolicyUpdatedAt,
    identity.privacyPolicy
  )
})

// The primary host from the config, for when the domain lists cannot be read.
const configuredHost = () => {
  try {
    return getConfig().host
  } catch {
    return ''
  }
}

/**
 * The identity of the domain `host` names. `host` must come from
 * `headerHost` (trust-filtered); anything it does not name falls back to the
 * primary.
 *
 * Each field is the domain's own override (Admin › Domains) while its row is
 * usable, else the resolved server setting (Admin › Instance: env → database
 * → default). Only an env domain (ACTIVITIES_TRUSTED_HOSTS) or an active row
 * in the served-domain snapshot can carry overrides; the primary, a wildcard
 * preview host and an off or removed domain use the server identity. Never
 * throws: a failed read logs and serves the server identity (from env +
 * defaults when the settings cannot be read either).
 */
export const resolveDomainIdentity = async (
  database: Database | null,
  host: string | null | undefined
): Promise<DomainIdentity> => {
  let domain = normalizeServedDomainChoice(host) ?? configuredHost()
  let source: DomainIdentity['source'] = 'other'
  try {
    await ensureServedDomainsFresh()
    const env = getEnvDomains()
    domain =
      normalizeServedDomainChoice(host) ?? env.primary ?? getConfig().host
    source =
      getEnvDomainKind(domain, env) ??
      (getActiveServedDomainNames().includes(domain) ? 'database' : 'other')
  } catch (error) {
    logger.error({
      message: 'Failed to resolve the visited domain',
      err: toLoggableError(error)
    })
  }

  let view: ServerSettingsView
  try {
    // Serves the last-known-good settings itself when the database fails.
    view = await getServerSettingsView(database)
  } catch (error) {
    logger.error({
      message: 'Failed to resolve the domain identity',
      err: toLoggableError(error)
    })
    view = await getServerSettingsView(null)
  }
  const identity = serverIdentity(view, domain, source)
  if (!database || (source !== 'env' && source !== 'database')) {
    return identity
  }

  try {
    const overrides = await readDomainOverrides(database, domain, source)
    return overrides ? applyOverrides(identity, overrides) : identity
  } catch (error) {
    logger.error({
      message: 'Failed to read the domain identity overrides',
      domain,
      err: toLoggableError(error)
    })
    return identity
  }
}

/**
 * The identity of the domain the current page request arrived on, for server
 * components. Memoized per request; route handlers call
 * `resolveDomainIdentity` with their own request's `headerHost` instead.
 */
export const getVisitedDomainIdentity = cache(
  async (): Promise<DomainIdentity> => {
    // Refresh first: `headerHost` trusts the visited host from the snapshot.
    await ensureServedDomainsFresh()
    return resolveDomainIdentity(getDatabase(), headerHost(await headers()))
  }
)

// Every admin domain write (identity, policies, status, remove) calls it.
export { invalidateDomainIdentityCache } from './domainIdentityCache'
