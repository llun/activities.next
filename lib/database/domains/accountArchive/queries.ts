import { randomBytes } from 'crypto'
import type { Selectable } from 'kysely'

import type {
  CreateAccountArchiveParams,
  DeleteAccountArchivesForAccountParams,
  GetAccountArchiveParams,
  GetAccountArchivesForAccountParams,
  GetActiveAccountArchiveParams,
  GetExpiredAccountArchivesParams,
  GetLatestRequestedAccountArchiveParams,
  GetStaleAccountArchivesParams,
  UpdateAccountArchiveParams
} from '@/lib/database/domains/accountArchive/types'
import type { Db } from '@/lib/database/kysely'
import type { AccountArchives } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import type {
  AccountArchive,
  AccountArchiveOptions,
  AccountArchiveStatus
} from '@/lib/types/domain/accountArchive'

type Row = Selectable<AccountArchives>

const parseOptions = (value: string): AccountArchiveOptions => {
  try {
    const parsed: unknown = JSON.parse(value)
    const record =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {}
    return {
      stripExactLocations: record.stripExactLocations === true,
      drafts: record.drafts === true
    }
  } catch {
    return { stripExactLocations: false, drafts: false }
  }
}

const toArchive = (row: Row): AccountArchive => ({
  id: row.id,
  accountId: row.accountId,
  status: row.status as AccountArchiveStatus,
  options: parseOptions(row.options),
  storageToken: row.storageToken,
  progress: row.progress ?? null,
  storagePath: row.storagePath ?? null,
  bytes: row.bytes ?? null,
  error: row.error ?? null,
  createdAt: row.createdAt,
  heartbeatAt: row.heartbeatAt,
  reapCount: row.reapCount,
  readyAt: row.readyAt ?? null,
  expiresAt: row.expiresAt ?? null
})

export const createAccountArchive = async (
  db: Db,
  {
    id,
    accountId,
    options,
    storageToken = randomBytes(32).toString('base64url')
  }: CreateAccountArchiveParams
): Promise<AccountArchive> => {
  await db
    .insertInto('account_archives')
    .values({
      id,
      accountId,
      status: 'queued',
      options: JSON.stringify(options),
      storageToken,
      createdAt: new Date(),
      heartbeatAt: new Date()
    })
    .execute()
  const row = await db
    .selectFrom('account_archives')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
  return toArchive(row)
}

export const getAccountArchive = async (
  db: Db,
  { id }: GetAccountArchiveParams
): Promise<AccountArchive | null> => {
  const row = await db
    .selectFrom('account_archives')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return row ? toArchive(row) : null
}

export const getAccountArchivesForAccount = async (
  db: Db,
  { accountId, limit }: GetAccountArchivesForAccountParams
): Promise<AccountArchive[]> => {
  const rows = await db
    .selectFrom('account_archives')
    .selectAll()
    .where('accountId', '=', accountId)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute()
  return rows.map(toArchive)
}

export const getActiveAccountArchive = async (
  db: Db,
  { accountId }: GetActiveAccountArchiveParams
): Promise<AccountArchive | null> => {
  const row = await db
    .selectFrom('account_archives')
    .selectAll()
    .where('accountId', '=', accountId)
    .where('status', 'in', ['queued', 'running'])
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row ? toArchive(row) : null
}

export const getLatestRequestedAccountArchive = async (
  db: Db,
  { accountId }: GetLatestRequestedAccountArchiveParams
): Promise<AccountArchive | null> => {
  const row = await db
    .selectFrom('account_archives')
    .selectAll()
    .where('accountId', '=', accountId)
    .where('status', '!=', 'failed')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row ? toArchive(row) : null
}

export const updateAccountArchive = async (
  db: Db,
  {
    id,
    onlyIfStatus,
    onlyIfProgress,
    onlyIfReapCount,
    status,
    progress,
    storagePath,
    bytes,
    error,
    readyAt,
    expiresAt,
    heartbeatAt,
    reapCount
  }: UpdateAccountArchiveParams
): Promise<AccountArchive | null> => {
  const values: Record<string, unknown> = {}
  if (status !== undefined) values.status = status
  if (progress !== undefined) {
    values.progress = progress
    values.heartbeatAt = new Date()
  }
  if (heartbeatAt !== undefined) values.heartbeatAt = new Date(heartbeatAt)
  if (reapCount !== undefined) values.reapCount = reapCount
  if (storagePath !== undefined) values.storagePath = storagePath
  if (bytes !== undefined) values.bytes = bytes
  if (error !== undefined) values.error = error
  if (readyAt !== undefined) {
    values.readyAt = readyAt === null ? null : new Date(readyAt)
  }
  if (expiresAt !== undefined) {
    values.expiresAt = expiresAt === null ? null : new Date(expiresAt)
  }

  if (Object.keys(values).length > 0) {
    let query = db
      .updateTable('account_archives')
      .set(values)
      .where('id', '=', id)
    if (onlyIfStatus) query = query.where('status', 'in', onlyIfStatus)
    if (onlyIfProgress !== undefined) {
      query =
        onlyIfProgress === null
          ? query.where('progress', 'is', null)
          : query.where('progress', '=', onlyIfProgress)
    }
    if (onlyIfReapCount !== undefined) {
      query = query.where('reapCount', '=', onlyIfReapCount)
    }
    const result = await query.executeTakeFirst()
    if (Number(result.numUpdatedRows) === 0) return null
  }

  return getAccountArchive(db, { id })
}

export const getExpiredAccountArchives = async (
  db: Db,
  { now, limit }: GetExpiredAccountArchivesParams
): Promise<AccountArchive[]> => {
  const rows = await db
    .selectFrom('account_archives')
    .selectAll()
    .where('status', '=', 'ready')
    .where('expiresAt', '<=', timestampValue(now))
    .orderBy('expiresAt', 'asc')
    .limit(limit)
    .execute()
  return rows.map(toArchive)
}

export const getStaleAccountArchives = async (
  db: Db,
  { before, limit }: GetStaleAccountArchivesParams
): Promise<AccountArchive[]> => {
  const rows = await db
    .selectFrom('account_archives')
    .selectAll()
    .where('status', 'in', ['queued', 'running'])
    .where('heartbeatAt', '<=', timestampValue(before))
    .orderBy('heartbeatAt', 'asc')
    .limit(limit)
    .execute()
  return rows.map(toArchive)
}

export const deleteAccountArchivesForAccount = async (
  db: Db,
  { accountId }: DeleteAccountArchivesForAccountParams
): Promise<void> => {
  await db
    .deleteFrom('account_archives')
    .where('accountId', '=', accountId)
    .execute()
}

export const accountArchiveQueries = {
  createAccountArchive,
  getAccountArchive,
  getAccountArchivesForAccount,
  getActiveAccountArchive,
  getLatestRequestedAccountArchive,
  updateAccountArchive,
  getExpiredAccountArchives,
  getStaleAccountArchives,
  deleteAccountArchivesForAccount
}
