// Parameter and result types of the served-domain domain: the `domains` table
// behind Admin › Domains. lib/types/database/operations.ts re-exports them.

export type ServedDomainStatus = 'on' | 'off'

export type DomainCheckItemStatus = 'passed' | 'failed' | 'skipped'

// One line of a reachability check, as the admin page shows it.
export type DomainCheckItem = {
  key: 'dns' | 'tls' | 'host'
  status: DomainCheckItemStatus
}

export type DomainCheckResult = {
  passed: boolean
  // Why the check stopped, for the copy under the failed items.
  reason:
    | 'passed'
    | 'dns'
    | 'private-address'
    | 'tls'
    | 'unreachable'
    | 'host-header'
    | 'other-server'
  items: DomainCheckItem[]
}

// A row of `domains`. `createdAt`/`updatedAt`/`lastCheckedAt` are epoch
// milliseconds whatever the backend stores.
export type ServedDomainData = {
  id: string
  // Normalized authority (`normalizeServedDomainChoice`).
  domain: string
  status: ServedDomainStatus
  name: string | null
  signupsOpen: boolean
  // Same matching as `registrations.allowEmails`; empty allows any address.
  allowedEmails: string[]
  allowExistingUsers: boolean
  lastCheckedAt: number | null
  lastCheckStatus: 'passed' | 'failed' | null
  lastCheckResult: DomainCheckResult | null
  createdAt: number
  updatedAt: number
}

export type CreateServedDomainParams = {
  domain: string
  status?: ServedDomainStatus
  name?: string | null
  signupsOpen?: boolean
  allowedEmails?: string[]
  allowExistingUsers?: boolean
  check?: DomainCheckResult | null
}

export type UpdateServedDomainParams = {
  domain: string
  status?: ServedDomainStatus
  name?: string | null
  signupsOpen?: boolean
  allowedEmails?: string[]
  allowExistingUsers?: boolean
  check?: DomainCheckResult
}

export type GetServedDomainParams = { domain: string }
export type DeleteServedDomainParams = { domain: string }
export type CountLocalActorsByDomainParams = { domains: string[] }

export interface ServedDomainDatabase {
  // Inserts a row (status `off` unless given). Throws on a duplicate domain.
  createServedDomain(
    params: CreateServedDomainParams
  ): Promise<ServedDomainData>
  // Partial update; bumps updatedAt. Null when the domain has no row.
  updateServedDomain(
    params: UpdateServedDomainParams
  ): Promise<ServedDomainData | null>
  getServedDomain(
    params: GetServedDomainParams
  ): Promise<ServedDomainData | null>
  // Every row, ordered by domain.
  getServedDomains(): Promise<ServedDomainData[]>
  // Rows whose status is `on`, ordered by domain.
  getActiveServedDomains(): Promise<ServedDomainData[]>
  // True when a row was removed.
  deleteServedDomain(params: DeleteServedDomainParams): Promise<boolean>
  // Local actors (with an account) per domain, for the given domains only.
  // A domain with none is absent from the map.
  countLocalActorsByDomain(
    params: CountLocalActorsByDomainParams
  ): Promise<Record<string, number>>
}
