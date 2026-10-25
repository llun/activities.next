// Parameter and result types of the served-domain domain: the `domains` table
// behind Admin › Served domains. lib/types/database/operations.ts re-exports them.
import type { DomainFeature } from '@/lib/services/domains/domainFeatures'

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
  // The domain's own identity; null means "Same as server" (Admin › Server settings).
  name: string | null
  description: string | null
  contactEmail: string | null
  // The optional features this domain turns off; empty means none.
  disabledFeatures: DomainFeature[]
  signupsOpen: boolean
  // Same matching as `registrations.allowEmails`; empty allows any address.
  // Null when the stored value cannot be read as a list: not the same as
  // empty, so no caller may treat it as "anyone" (`signupsOpen` is then false).
  allowedEmails: string[] | null
  allowExistingUsers: boolean
  lastCheckedAt: number | null
  lastCheckStatus: 'passed' | 'failed' | null
  lastCheckResult: DomainCheckResult | null
  createdAt: number
  updatedAt: number
}

// A domain's own terms of service and privacy policy (Markdown), null when it
// uses the server's. `*UpdatedAt` is when that text last changed (epoch ms),
// null while there is none. Kept out of `ServedDomainData` because the lists
// (and the served-domain snapshot, reloaded every 30 s) never need them.
export type ServedDomainPolicies = {
  termsOfService: string | null
  termsOfServiceUpdatedAt: number | null
  privacyPolicy: string | null
  privacyPolicyUpdatedAt: number | null
}

export type ServedDomainWithPoliciesData = ServedDomainData &
  ServedDomainPolicies

// Identity and policy columns a create or update may set. Undefined leaves a
// column as it is (on create: null); null clears it. The caller decides the
// `*UpdatedAt` values (lib/services/domains/adminDomains.ts).
type ServedDomainIdentityParams = {
  name?: string | null
  description?: string | null
  contactEmail?: string | null
  // Empty or null clears the list.
  disabledFeatures?: DomainFeature[] | null
  termsOfService?: string | null
  termsOfServiceUpdatedAt?: number | null
  privacyPolicy?: string | null
  privacyPolicyUpdatedAt?: number | null
}

export type CreateServedDomainParams = ServedDomainIdentityParams & {
  domain: string
  status?: ServedDomainStatus
  signupsOpen?: boolean
  allowedEmails?: string[]
  allowExistingUsers?: boolean
  check?: DomainCheckResult | null
}

export type UpdateServedDomainParams = ServedDomainIdentityParams & {
  domain: string
  status?: ServedDomainStatus
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
  // Without the policy texts.
  getServedDomain(
    params: GetServedDomainParams
  ): Promise<ServedDomainData | null>
  // The row with its terms of service and privacy policy.
  getServedDomainWithPolicies(
    params: GetServedDomainParams
  ): Promise<ServedDomainWithPoliciesData | null>
  // Every row, ordered by domain, without the policy texts.
  getServedDomains(): Promise<ServedDomainData[]>
  // Rows whose status is `on`, ordered by domain, without the policy texts.
  getActiveServedDomains(): Promise<ServedDomainData[]>
  // True when a row was removed.
  deleteServedDomain(params: DeleteServedDomainParams): Promise<boolean>
  // Removes the domain with its rules and announcements, in one transaction.
  // True when the domain row was removed.
  deleteServedDomainWithScopes(
    params: DeleteServedDomainParams
  ): Promise<boolean>
  // Local actors (with an account) per domain, for the given domains only.
  // A domain with none is absent from the map.
  countLocalActorsByDomain(
    params: CountLocalActorsByDomainParams
  ): Promise<Record<string, number>>
}
