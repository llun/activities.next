import {
  type ClearDeliveryFailuresParams,
  DELIVERY_FAILURE_DAYS_THRESHOLD,
  type GetUnavailableDomainsParams,
  type IsDomainUnavailableParams,
  MAX_DELIVERY_LAST_ERROR_LENGTH,
  type RecordDeliveryFailureParams
} from '@/lib/database/domains/deliveryDomains/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { selectInChunks } from '@/lib/database/kysely/inList'

const normalizeDomain = (domain: string): string => domain.trim().toLowerCase()

const formatUtcDay = (date: Date): string => date.toISOString().slice(0, 10)

const normalizeLastError = (
  error: string | null | undefined
): string | null => {
  if (!error) return null
  const trimmed = error.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_DELIVERY_LAST_ERROR_LENGTH)
}

export const recordDeliveryFailure = async (
  db: Db,
  { domain, error, now }: RecordDeliveryFailureParams
): Promise<boolean> => {
  const normalized = normalizeDomain(domain)
  if (!normalized) return false

  const nowDate = now instanceof Date ? now : new Date(now ?? Date.now())
  const dayKey = formatUtcDay(nowDate)
  const lastError = normalizeLastError(error)

  return inTransaction(db, async (trx) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await trx
        .insertInto('delivery_domain_failures')
        .values({
          domain: normalized,
          failureDays: 0,
          lastFailureDay: null,
          firstFailureAt: nowDate,
          lastFailureAt: nowDate,
          unavailableSince: null,
          lastError: null,
          createdAt: nowDate,
          updatedAt: nowDate
        })
        .onConflict((oc) => oc.column('domain').doNothing())
        .execute()

      const row = await forUpdate(
        trx,
        trx
          .selectFrom('delivery_domain_failures')
          .select([
            'domain',
            'failureDays',
            'lastFailureDay',
            'unavailableSince'
          ])
          .where('domain', '=', normalized)
      ).executeTakeFirst()

      if (!row) {
        continue
      }

      const isFirstFailure =
        row.failureDays === 0 && row.lastFailureDay === null
      const isNewDay =
        row.lastFailureDay === null || dayKey > row.lastFailureDay
      const nextLastFailureDay = isNewDay ? dayKey : row.lastFailureDay
      const nextFailureDays = isNewDay ? row.failureDays + 1 : row.failureDays
      const wasUnavailable =
        row.unavailableSince !== null && row.unavailableSince !== undefined
      const markedUnavailableNow =
        !wasUnavailable && nextFailureDays >= DELIVERY_FAILURE_DAYS_THRESHOLD

      await trx
        .updateTable('delivery_domain_failures')
        .set({
          failureDays: nextFailureDays,
          lastFailureDay: nextLastFailureDay,
          ...(isFirstFailure ? { firstFailureAt: nowDate } : {}),
          lastFailureAt: nowDate,
          ...(markedUnavailableNow ? { unavailableSince: nowDate } : {}),
          lastError,
          updatedAt: nowDate
        })
        .where('domain', '=', normalized)
        .execute()

      return markedUnavailableNow
    }

    return false
  })
}

export const clearDeliveryFailures = async (
  db: Db,
  { domain }: ClearDeliveryFailuresParams
): Promise<void> => {
  const normalized = normalizeDomain(domain)
  if (!normalized) return

  await db
    .deleteFrom('delivery_domain_failures')
    .where('domain', '=', normalized)
    .execute()
}

export const getUnavailableDomains = async (
  db: Db,
  { domains }: GetUnavailableDomainsParams
): Promise<string[]> => {
  const normalized = Array.from(
    new Set(domains.map(normalizeDomain).filter(Boolean))
  )
  if (normalized.length === 0) return []

  const rows = await selectInChunks(db, normalized, (chunk) =>
    db
      .selectFrom('delivery_domain_failures')
      .select('domain')
      .where('domain', 'in', chunk)
      .where('unavailableSince', 'is not', null)
      .execute()
  )

  return rows.map((row) => row.domain)
}

export const isDomainUnavailable = async (
  db: Db,
  { domain }: IsDomainUnavailableParams
): Promise<boolean> => {
  const normalized = normalizeDomain(domain)
  if (!normalized) return false

  const row = await db
    .selectFrom('delivery_domain_failures')
    .select('domain')
    .where('domain', '=', normalized)
    .where('unavailableSince', 'is not', null)
    .limit(1)
    .executeTakeFirst()

  return Boolean(row)
}

export const deliveryDomainsQueries = {
  recordDeliveryFailure,
  clearDeliveryFailures,
  getUnavailableDomains,
  isDomainUnavailable
}
