import type { Selectable } from 'kysely'
import { randomUUID } from 'node:crypto'

import type {
  CountLocalActorsByDomainParams,
  CreateServedDomainParams,
  DeleteServedDomainParams,
  DomainCheckResult,
  GetServedDomainParams,
  ServedDomainData,
  ServedDomainWithPoliciesData,
  UpdateServedDomainParams
} from '@/lib/database/domains/servedDomain/types'
import type { Db } from '@/lib/database/kysely'
import type { Domains } from '@/lib/database/kysely/db'
import { isLocalActor } from '@/lib/database/kysely/visibility/localActor'
import { parseDisabledFeatures } from '@/lib/services/domains/domainFeatures'
import { logger } from '@/lib/utils/logger'

// Null when the stored value is not a JSON array of strings: an empty list
// would mean "anyone may sign up", so the caller closes sign-ups instead (fail
// closed).
const parseEmails = (value: string | null | undefined): string[] | null => {
  try {
    const parsed: unknown = JSON.parse(value ?? '')
    if (
      Array.isArray(parsed) &&
      parsed.every((item): item is string => typeof item === 'string')
    ) {
      return parsed
    }
  } catch {
    // Logged below.
  }
  return null
}

const parseCheck = (
  value: string | null | undefined
): DomainCheckResult | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as DomainCheckResult
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.items)
      ? parsed
      : null
  } catch {
    return null
  }
}

// Every column but the policy texts: the lists and the served-domain snapshot
// (reloaded every 30 s) read only these.
const SERVED_DOMAIN_COLUMNS = [
  'id',
  'domain',
  'status',
  'name',
  'description',
  'contactEmail',
  'disabledFeatures',
  'signupsOpen',
  'allowedEmails',
  'allowExistingUsers',
  'lastCheckedAt',
  'lastCheckStatus',
  'lastCheckResult',
  'createdAt',
  'updatedAt'
] as const

type ServedDomainRow = Pick<
  Selectable<Domains>,
  (typeof SERVED_DOMAIN_COLUMNS)[number]
>

const toServedDomain = (row: ServedDomainRow): ServedDomainData => {
  const allowedEmails = parseEmails(row.allowedEmails)
  if (!allowedEmails) {
    logger.error({
      message: 'Unreadable allowedEmails on a domains row; sign-ups closed',
      domain: row.domain
    })
  }
  return {
    id: row.id,
    domain: row.domain,
    status: row.status === 'on' ? 'on' : 'off',
    name: row.name ?? null,
    description: row.description ?? null,
    contactEmail: row.contactEmail ?? null,
    disabledFeatures: parseDisabledFeatures(row.disabledFeatures),
    signupsOpen: Boolean(allowedEmails && row.signupsOpen),
    allowedEmails,
    allowExistingUsers: Boolean(row.allowExistingUsers),
    lastCheckedAt: row.lastCheckedAt ?? null,
    lastCheckStatus:
      row.lastCheckStatus === 'passed' || row.lastCheckStatus === 'failed'
        ? row.lastCheckStatus
        : null,
    lastCheckResult: parseCheck(row.lastCheckResult),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

const toDate = (value: number | null | undefined) =>
  value === null || value === undefined ? null : new Date(value)

// The identity and policy columns a create or update was given, as Kysely
// values; absent keys are left out so the row keeps what it has.
const identityValues = ({
  name,
  description,
  contactEmail,
  disabledFeatures,
  termsOfService,
  termsOfServiceUpdatedAt,
  privacyPolicy,
  privacyPolicyUpdatedAt
}: CreateServedDomainParams | UpdateServedDomainParams) => ({
  ...(name !== undefined ? { name } : null),
  ...(description !== undefined ? { description } : null),
  ...(contactEmail !== undefined ? { contactEmail } : null),
  ...(disabledFeatures !== undefined
    ? {
        disabledFeatures: disabledFeatures?.length
          ? JSON.stringify(disabledFeatures)
          : null
      }
    : null),
  ...(termsOfService !== undefined ? { termsOfService } : null),
  ...(termsOfServiceUpdatedAt !== undefined
    ? { termsOfServiceUpdatedAt: toDate(termsOfServiceUpdatedAt) }
    : null),
  ...(privacyPolicy !== undefined ? { privacyPolicy } : null),
  ...(privacyPolicyUpdatedAt !== undefined
    ? { privacyPolicyUpdatedAt: toDate(privacyPolicyUpdatedAt) }
    : null)
})

export const getServedDomain = async (
  db: Db,
  { domain }: GetServedDomainParams
): Promise<ServedDomainData | null> => {
  const row = await db
    .selectFrom('domains')
    .select(SERVED_DOMAIN_COLUMNS)
    .where('domain', '=', domain)
    .limit(1)
    .executeTakeFirst()
  return row ? toServedDomain(row) : null
}

export const getServedDomainWithPolicies = async (
  db: Db,
  { domain }: GetServedDomainParams
): Promise<ServedDomainWithPoliciesData | null> => {
  const row = await db
    .selectFrom('domains')
    .select([
      ...SERVED_DOMAIN_COLUMNS,
      'termsOfService',
      'termsOfServiceUpdatedAt',
      'privacyPolicy',
      'privacyPolicyUpdatedAt'
    ])
    .where('domain', '=', domain)
    .limit(1)
    .executeTakeFirst()
  if (!row) return null
  return {
    ...toServedDomain(row),
    termsOfService: row.termsOfService ?? null,
    termsOfServiceUpdatedAt: row.termsOfServiceUpdatedAt ?? null,
    privacyPolicy: row.privacyPolicy ?? null,
    privacyPolicyUpdatedAt: row.privacyPolicyUpdatedAt ?? null
  }
}

export const createServedDomain = async (
  db: Db,
  params: CreateServedDomainParams
): Promise<ServedDomainData> => {
  const {
    domain,
    status = 'off',
    signupsOpen = false,
    allowedEmails = [],
    allowExistingUsers = false,
    check = null
  } = params
  const currentTime = new Date()
  await db
    .insertInto('domains')
    .values({
      id: randomUUID(),
      domain,
      status,
      name: null,
      ...identityValues(params),
      signupsOpen,
      allowedEmails: JSON.stringify(allowedEmails),
      allowExistingUsers,
      lastCheckedAt: check ? currentTime : null,
      lastCheckStatus: check ? (check.passed ? 'passed' : 'failed') : null,
      lastCheckResult: check ? JSON.stringify(check) : null,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()
  const created = await getServedDomain(db, { domain })
  if (!created) throw new Error(`Domain ${domain} was not created`)
  return created
}

export const updateServedDomain = async (
  db: Db,
  params: UpdateServedDomainParams
): Promise<ServedDomainData | null> => {
  const {
    domain,
    status,
    signupsOpen,
    allowedEmails,
    allowExistingUsers,
    check
  } = params
  const currentTime = new Date()
  const { numUpdatedRows } = await db
    .updateTable('domains')
    .set({
      ...(status !== undefined ? { status } : null),
      ...identityValues(params),
      ...(signupsOpen !== undefined ? { signupsOpen } : null),
      ...(allowedEmails !== undefined
        ? { allowedEmails: JSON.stringify(allowedEmails) }
        : null),
      ...(allowExistingUsers !== undefined ? { allowExistingUsers } : null),
      ...(check !== undefined
        ? {
            lastCheckedAt: currentTime,
            lastCheckStatus: check.passed ? 'passed' : 'failed',
            lastCheckResult: JSON.stringify(check)
          }
        : null),
      updatedAt: currentTime
    })
    .where('domain', '=', domain)
    .executeTakeFirst()
  if (Number(numUpdatedRows) === 0) return null
  return getServedDomain(db, { domain })
}

export const getServedDomains = async (db: Db): Promise<ServedDomainData[]> => {
  const rows = await db
    .selectFrom('domains')
    .select(SERVED_DOMAIN_COLUMNS)
    .orderBy('domain', 'asc')
    .execute()
  return rows.map(toServedDomain)
}

export const getActiveServedDomains = async (
  db: Db
): Promise<ServedDomainData[]> => {
  const rows = await db
    .selectFrom('domains')
    .select(SERVED_DOMAIN_COLUMNS)
    .where('status', '=', 'on')
    .orderBy('domain', 'asc')
    .execute()
  return rows.map(toServedDomain)
}

export const deleteServedDomain = async (
  db: Db,
  { domain }: DeleteServedDomainParams
): Promise<boolean> => {
  const { numDeletedRows } = await db
    .deleteFrom('domains')
    .where('domain', '=', domain)
    .executeTakeFirst()
  return Number(numDeletedRows) > 0
}

export const countLocalActorsByDomain = async (
  db: Db,
  { domains }: CountLocalActorsByDomainParams
): Promise<Record<string, number>> => {
  if (domains.length === 0) return {}
  const rows = await db
    .selectFrom('actors')
    .select((eb) => ['domain', eb.fn.countAll<number | string>().as('total')])
    .where('domain', 'in', domains)
    .where('accountId', 'is not', null)
    .where(isLocalActor)
    .groupBy('domain')
    .execute()
  const counts: Record<string, number> = {}
  for (const row of rows) {
    if (row.domain) counts[row.domain] = Number(row.total)
  }
  return counts
}

export const servedDomainQueries = {
  createServedDomain,
  updateServedDomain,
  getServedDomain,
  getServedDomainWithPolicies,
  getServedDomains,
  getActiveServedDomains,
  deleteServedDomain,
  countLocalActorsByDomain
}
