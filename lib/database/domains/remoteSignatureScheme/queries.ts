import {
  type DeleteExpiredRemoteSignatureSchemesParams,
  type GetRemoteSignatureSchemeParams,
  REMOTE_SIGNATURE_SCHEMES,
  type RemoteSignatureScheme,
  type RemoteSignatureSchemeEntry,
  type UpsertRemoteSignatureSchemeParams
} from '@/lib/database/domains/remoteSignatureScheme/types'
import type { Db } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import { normalizeActorHost } from '@/lib/services/federation/domainRules'

const toDate = (value?: number | Date): Date =>
  value instanceof Date ? value : new Date(value ?? Date.now())

export const getRemoteSignatureScheme = async (
  db: Db,
  { domain, now }: GetRemoteSignatureSchemeParams
): Promise<RemoteSignatureSchemeEntry | null> => {
  const normalized = normalizeActorHost(domain)
  if (!normalized) return null

  const nowMs = now instanceof Date ? now.getTime() : (now ?? Date.now())
  if (!Number.isFinite(nowMs)) return null

  const row = await db
    .selectFrom('remote_signature_schemes')
    .selectAll()
    .where('domain', '=', normalized)
    .limit(1)
    .executeTakeFirst()
  if (!row) return null

  if (!(REMOTE_SIGNATURE_SCHEMES as readonly string[]).includes(row.scheme)) {
    return null
  }

  const expiresAt = getCompatibleTime(row.expiresAt)
  // Expiry is checked on the parsed epoch timestamp so mixed SQLite storage
  // representations never return an expired row.
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return null

  return {
    domain: row.domain,
    scheme: row.scheme as RemoteSignatureScheme,
    expiresAt,
    createdAt: getCompatibleTime(row.createdAt),
    updatedAt: getCompatibleTime(row.updatedAt)
  }
}

export const upsertRemoteSignatureScheme = async (
  db: Db,
  { domain, scheme, expiresAt, now }: UpsertRemoteSignatureSchemeParams
): Promise<void> => {
  const normalized = normalizeActorHost(domain)
  if (!normalized) return

  if (!(REMOTE_SIGNATURE_SCHEMES as readonly string[]).includes(scheme)) {
    throw new Error(`Unknown remote signature scheme: ${scheme}`)
  }

  const nowDate = toDate(now)
  const expiresAtDate = toDate(expiresAt)
  if (
    !Number.isFinite(nowDate.getTime()) ||
    !Number.isFinite(expiresAtDate.getTime())
  ) {
    return
  }

  await db
    .insertInto('remote_signature_schemes')
    .values({
      domain: normalized,
      scheme,
      expiresAt: expiresAtDate,
      createdAt: nowDate,
      updatedAt: nowDate
    })
    .onConflict((oc) =>
      oc.column('domain').doUpdateSet((eb) => ({
        scheme: eb.ref('excluded.scheme'),
        expiresAt: eb.ref('excluded.expiresAt'),
        updatedAt: eb.ref('excluded.updatedAt')
      }))
    )
    .execute()
}

export const deleteExpiredRemoteSignatureSchemes = async (
  db: Db,
  { before, limit }: DeleteExpiredRemoteSignatureSchemesParams = {}
): Promise<number> => {
  const beforeDate = toDate(before)
  if (!Number.isFinite(beforeDate.getTime())) return 0

  if (limit === undefined) {
    const { numDeletedRows } = await db
      .deleteFrom('remote_signature_schemes')
      .where('expiresAt', '<=', timestampValue(beforeDate))
      .executeTakeFirst()
    return Number(numDeletedRows)
  }

  const size = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (size === 0) return 0

  const rows = await db
    .selectFrom('remote_signature_schemes')
    .select('domain')
    .where('expiresAt', '<=', timestampValue(beforeDate))
    .orderBy('expiresAt', 'asc')
    .limit(size)
    .execute()
  if (rows.length === 0) return 0

  let deleted = 0
  const batchSize = Math.max(1, getWhereInBatchSize(db, 1))
  for (const chunk of chunkArray(
    rows.map((row) => row.domain),
    batchSize
  )) {
    const result = await db
      .deleteFrom('remote_signature_schemes')
      .where('domain', 'in', chunk)
      .where('expiresAt', '<=', timestampValue(beforeDate))
      .executeTakeFirst()
    deleted += Number(result.numDeletedRows)
  }
  return deleted
}

export const remoteSignatureSchemeQueries = {
  getRemoteSignatureScheme,
  upsertRemoteSignatureScheme,
  deleteExpiredRemoteSignatureSchemes
}
