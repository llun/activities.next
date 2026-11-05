import {
  type ClearDeliveryFailuresForDomainParams,
  type ClearDeliveryFailuresParams,
  DELIVERY_FAILURE_DAYS_THRESHOLD,
  DELIVERY_UNAVAILABLE_PROBE_INTERVAL_MS,
  type GetUnavailableInboxesParams,
  type IsInboxUnavailableParams,
  MAX_DELIVERY_LAST_ERROR_LENGTH,
  type RecordDeliveryFailureParams
} from '@/lib/database/domains/deliveryInboxes/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { forUpdate, timestampValue } from '@/lib/database/kysely/dialect'
import { selectInChunks } from '@/lib/database/kysely/inList'
import { getDomainFromUrl } from '@/lib/services/federation/domainPolicy'

const normalizeDomain = (domain: string): string => domain.trim().toLowerCase()

const formatUtcDay = (date: Date): string => date.toISOString().slice(0, 10)

const toDate = (now?: number | Date): Date =>
  now instanceof Date ? now : new Date(now ?? Date.now())

// Failed within the probe interval: older failures allow delivery probes.
const probeCutoff = (now?: number | Date): Date =>
  new Date(toDate(now).getTime() - DELIVERY_UNAVAILABLE_PROBE_INTERVAL_MS)

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
  { inbox, error, now }: RecordDeliveryFailureParams
): Promise<boolean> => {
  const domain = getDomainFromUrl(inbox)
  if (!domain) return false

  const nowDate = now instanceof Date ? now : new Date(now ?? Date.now())
  const dayKey = formatUtcDay(nowDate)
  const lastError = normalizeLastError(error)

  return inTransaction(db, async (trx) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await trx
        .insertInto('delivery_inbox_failures')
        .values({
          inbox,
          domain,
          failureDays: 0,
          lastFailureDay: null,
          firstFailureAt: nowDate,
          lastFailureAt: nowDate,
          unavailableSince: null,
          lastError: null,
          createdAt: nowDate,
          updatedAt: nowDate
        })
        .onConflict((oc) => oc.column('inbox').doNothing())
        .execute()

      const row = await forUpdate(
        trx,
        trx
          .selectFrom('delivery_inbox_failures')
          .select([
            'inbox',
            'failureDays',
            'lastFailureDay',
            'unavailableSince'
          ])
          .where('inbox', '=', inbox)
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
        .updateTable('delivery_inbox_failures')
        .set({
          failureDays: nextFailureDays,
          lastFailureDay: nextLastFailureDay,
          ...(isFirstFailure ? { firstFailureAt: nowDate } : {}),
          lastFailureAt: nowDate,
          ...(markedUnavailableNow ? { unavailableSince: nowDate } : {}),
          lastError,
          updatedAt: nowDate
        })
        .where('inbox', '=', inbox)
        .execute()

      return markedUnavailableNow
    }

    return false
  })
}

export const clearDeliveryFailures = async (
  db: Db,
  { inbox }: ClearDeliveryFailuresParams
): Promise<void> => {
  // Avoid taking SQLite's write lock when this frequently called clear has no row.
  const existing = await db
    .selectFrom('delivery_inbox_failures')
    .select('inbox')
    .where('inbox', '=', inbox)
    .limit(1)
    .executeTakeFirst()
  if (!existing) return

  await db
    .deleteFrom('delivery_inbox_failures')
    .where('inbox', '=', inbox)
    .execute()
}

export const clearDeliveryFailuresForDomain = async (
  db: Db,
  { domain }: ClearDeliveryFailuresForDomainParams
): Promise<void> => {
  const normalized = normalizeDomain(domain)
  if (!normalized) return

  const existing = await db
    .selectFrom('delivery_inbox_failures')
    .select('inbox')
    .where('domain', '=', normalized)
    .limit(1)
    .executeTakeFirst()
  if (!existing) return

  await db
    .deleteFrom('delivery_inbox_failures')
    .where('domain', '=', normalized)
    .execute()
}

export const getUnavailableInboxes = async (
  db: Db,
  { inboxes, now }: GetUnavailableInboxesParams
): Promise<string[]> => {
  const uniqueInboxes = Array.from(new Set(inboxes))
  if (uniqueInboxes.length === 0) return []

  const rows = await selectInChunks(db, uniqueInboxes, (chunk) =>
    db
      .selectFrom('delivery_inbox_failures')
      .select('inbox')
      .where('inbox', 'in', chunk)
      .where('unavailableSince', 'is not', null)
      .where('lastFailureAt', '>', timestampValue(probeCutoff(now)))
      .execute()
  )

  return rows.map((row) => row.inbox)
}

export const isInboxUnavailable = async (
  db: Db,
  { inbox, now }: IsInboxUnavailableParams
): Promise<boolean> => {
  const row = await db
    .selectFrom('delivery_inbox_failures')
    .select('inbox')
    .where('inbox', '=', inbox)
    .where('unavailableSince', 'is not', null)
    .where('lastFailureAt', '>', timestampValue(probeCutoff(now)))
    .limit(1)
    .executeTakeFirst()

  return Boolean(row)
}

export const deliveryInboxesQueries = {
  recordDeliveryFailure,
  clearDeliveryFailures,
  clearDeliveryFailuresForDomain,
  getUnavailableInboxes,
  isInboxUnavailable
}
