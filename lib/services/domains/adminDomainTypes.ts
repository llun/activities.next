// What Admin › Domains shows, shared by the API routes, the server pages and the
// client components. Dependency-free (type-only imports): client modules
// import it.
import type {
  DomainCheckItem,
  DomainCheckResult
} from '@/lib/database/domains/servedDomain/types'

export type AdminDomainSource =
  // ACTIVITIES_HOST: always on, its sign-up settings are Admin › Instance.
  | 'primary'
  // A concrete ACTIVITIES_TRUSTED_HOSTS entry: always on, sign-ups editable.
  | 'env'
  // A row an admin added: can be checked, turned on and off, removed.
  | 'database'

// The stored check result, shown as it is.
export type AdminDomainCheckItem = DomainCheckItem
export type AdminDomainCheck = DomainCheckResult

export type AdminDomain = {
  domain: string
  source: AdminDomainSource
  name: string | null
  status: 'on' | 'off'
  profiles: number
  signupsOpen: boolean
  allowedEmails: string[]
  allowExistingUsers: boolean
  lastCheckedAt: number | null
  lastCheck: AdminDomainCheck | null
}

/**
 * One domain's page: the list row plus its own identity and policies. Null in
 * any of these means "Same as server" (Admin › Instance); on the primary the
 * description, contact email and policies are null, as it uses the server's
 * own, and the name mirrors the server's name. The `*UpdatedAt`
 * dates are epoch ms, null while the domain sets no text of its own.
 */
export type AdminDomainDetail = AdminDomain & {
  description: string | null
  contactEmail: string | null
  termsOfService: string | null
  privacyPolicy: string | null
  termsOfServiceUpdatedAt: number | null
  privacyPolicyUpdatedAt: number | null
}

/**
 * The server's own identity (Admin › Instance) as a domain page shows it
 * beside "Same as server". The terms and privacy texts are left out on
 * purpose: the domain page only says whether they are set and when they last
 * changed.
 */
export type ServerIdentityView = {
  name: string
  description: string
  // '' when there is none.
  contactEmail: string
  // The contact account's handle (`@name`), null when there is none.
  contactAccount: string | null
  terms: { set: boolean; updatedAt: number | null }
  privacy: { set: boolean; updatedAt: number | null }
}

// The bodies `PATCH /api/v1/admin/domains/:domain` takes. A field left out
// stays as it is; null on an identity or policy field means "Same as server".
// `status` is sent on its own, never with the others.
export type AdminDomainRegistrationsPatch = {
  signupsOpen?: boolean
  allowedEmails?: string[]
  allowExistingUsers?: boolean
}

export type AdminDomainIdentityPatch = {
  name?: string | null
  description?: string | null
  contactEmail?: string | null
}

export type AdminDomainPoliciesPatch = {
  termsOfService?: string | null
  privacyPolicy?: string | null
}

export type AdminDomainSettingsPatch = AdminDomainRegistrationsPatch &
  AdminDomainIdentityPatch &
  AdminDomainPoliciesPatch

export type AdminDomainUpdateBody =
  AdminDomainSettingsPatch | { status: 'on' | 'off' }

// The longest value each identity and policy field takes (the API refuses
// longer ones; blank is refused too: send null for "Same as server").
export const ADMIN_DOMAIN_FIELD_LIMITS = {
  name: 255,
  description: 5000,
  contactEmail: 255,
  termsOfService: 100_000,
  privacyPolicy: 100_000
} as const

export const PRIMARY_DOMAIN_IDENTITY_ERROR =
  'The primary domain’s identity and policies are set in Admin › Instance.'

// A wildcard ACTIVITIES_TRUSTED_HOSTS entry: shown as an info row only.
export type AdminDomainWildcard = {
  rule: string
}

export type AdminDomainList = {
  domains: AdminDomain[]
  wildcards: AdminDomainWildcard[]
}

export type AddDomainError =
  'invalid' | 'wildcard' | 'primary' | 'env' | 'exists'

export const ADD_DOMAIN_ERROR_MESSAGES: Record<AddDomainError, string> = {
  invalid: 'Enter a domain name, such as photos.example.',
  wildcard: 'Wildcards can only be set in ACTIVITIES_TRUSTED_HOSTS.',
  primary: 'That is the primary domain, set by ACTIVITIES_HOST.',
  env: 'That domain is already set in ACTIVITIES_TRUSTED_HOSTS.',
  exists: 'That domain is already in the list.'
}

/** A `[domain]` route segment (API or page), decoded once and lowercased. */
export const readDomainRouteParam = (raw: string): string => {
  try {
    return decodeURIComponent(raw).trim().toLowerCase()
  } catch {
    return raw.trim().toLowerCase()
  }
}
