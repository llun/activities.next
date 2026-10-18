// What Admin › Domains shows, shared by the API routes, the server pages and the
// client components. Dependency-free: client modules import it.

export type AdminDomainSource =
  // ACTIVITIES_HOST: always on, its sign-up settings are Admin › Instance.
  | 'primary'
  // A concrete ACTIVITIES_TRUSTED_HOSTS entry: always on, sign-ups editable.
  | 'env'
  // A row an admin added: can be checked, turned on and off, removed.
  | 'database'

export type AdminDomainCheckItem = {
  key: 'dns' | 'tls' | 'host'
  status: 'passed' | 'failed' | 'skipped'
}

export type AdminDomainCheck = {
  passed: boolean
  reason:
    | 'passed'
    | 'dns'
    | 'private-address'
    | 'tls'
    | 'unreachable'
    | 'host-header'
    | 'other-server'
  items: AdminDomainCheckItem[]
}

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
