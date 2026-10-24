import { type Kysely, sql } from 'kysely'

import { ACCOUNT_EXPORT_TABLES } from '@/lib/database/domains/accountExport/tables'
import type {
  AccountExportAccount,
  AccountExportActor,
  AccountExportCursor,
  AccountExportRows,
  GetAccountExportAccountParams,
  GetAccountExportActorsParams,
  GetAccountExportRowsParams,
  OwnsAccountExportMediaPathParams
} from '@/lib/database/domains/accountExport/types'
import type { Db } from '@/lib/database/kysely'

// A loosely typed view of the root instance: the table and column names come
// from the allowlist in ./tables.ts, not from the generated `DB` types.
type DynamicDb = Kysely<Record<string, Record<string, unknown>>>

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const toTimestamp = (value: unknown): number | null =>
  typeof value === 'number' ? value : null

export const getAccountExportAccount = async (
  db: Db,
  { accountId }: GetAccountExportAccountParams
): Promise<AccountExportAccount | null> => {
  const row = await db
    .selectFrom('accounts')
    .select([
      'id',
      'email',
      'name',
      'signUpDomain',
      'defaultActorId',
      'createdAt',
      'verifiedAt',
      'emailVerifiedAt'
    ])
    .where('id', '=', accountId)
    .executeTakeFirst()
  if (!row) return null
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name ?? null,
    signUpDomain: row.signUpDomain ?? null,
    defaultActorId: row.defaultActorId ?? null,
    createdAt: toTimestamp(row.createdAt) ?? 0,
    verifiedAt: toTimestamp(row.verifiedAt),
    emailVerifiedAt: toTimestamp(row.emailVerifiedAt)
  }
}

export const getAccountExportActors = async (
  db: Db,
  { accountId }: GetAccountExportActorsParams
): Promise<AccountExportActor[]> => {
  // publicKey and privateKey are deliberately not selected.
  const rows = await db
    .selectFrom('actors')
    .select([
      'id',
      'publicId',
      'username',
      'domain',
      'name',
      'summary',
      'type',
      'createdAt',
      'settings'
    ])
    .where('accountId', '=', accountId)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute()
  return rows.map((row) => {
    const settings = parseJson(row.settings)
    return {
      id: row.id as string,
      publicId: row.publicId ?? null,
      username: row.username as string,
      domain: row.domain as string,
      name: row.name ?? null,
      summary: row.summary ?? null,
      type: row.type as string,
      createdAt: toTimestamp(row.createdAt) ?? 0,
      settings:
        settings && typeof settings === 'object' && !Array.isArray(settings)
          ? (settings as Record<string, unknown>)
          : {}
    }
  })
}

export const getAccountExportRows = async (
  db: Db,
  { table, actorId, after, limit }: GetAccountExportRowsParams
): Promise<AccountExportRows> => {
  const spec = ACCOUNT_EXPORT_TABLES[table]
  const dynamic = db as unknown as DynamicDb

  let query = dynamic
    .selectFrom(spec.table)
    // The sort key is read even when it is not an exported column (a settings
    // table keyed by actor id), because the next cursor is made from it.
    .select(
      [...new Set([...spec.columns, ...spec.key])].map((column) =>
        sql.ref(column).as(column)
      )
    )
    .where(spec.scope(actorId))

  if (spec.softDeletedColumn) {
    query = query.where(sql.ref(spec.softDeletedColumn), 'is', null)
  }

  if (after && after.length === spec.key.length) {
    const [first, second] = spec.key
    if (second === undefined) {
      query = query.where(sql.ref(first), '>', after[0])
    } else {
      query = query.where(
        sql<boolean>`(${sql.ref(first)} > ${after[0]} or (${sql.ref(first)} = ${after[0]} and ${sql.ref(second)} > ${after[1]}))`
      )
    }
  }

  for (const column of spec.key) query = query.orderBy(sql.ref(column), 'asc')

  const rows = (await query.limit(limit).execute()) as Record<string, unknown>[]

  const json = new Set(spec.json ?? [])
  const booleans = new Set(spec.booleans ?? [])
  const normalized = rows.map((row) => {
    const output: Record<string, unknown> = {}
    for (const column of spec.columns) {
      const value = row[column]
      if (json.has(column)) output[column] = parseJson(value)
      else if (booleans.has(column) && value !== null && value !== undefined)
        output[column] = Boolean(value)
      else output[column] = value ?? null
    }
    return output
  })

  const last = rows[rows.length - 1]
  const next: AccountExportCursor | null =
    rows.length === limit && last
      ? spec.key.map((column) => last[column] as string | number)
      : null

  return { rows: normalized, next }
}

export const ownsAccountExportMediaPath = async (
  db: Db,
  { accountId, path }: OwnsAccountExportMediaPathParams
): Promise<boolean> => {
  const row = await db
    .selectFrom('medias')
    .select('id')
    .where(
      'actorId',
      'in',
      db.selectFrom('actors').select('id').where('accountId', '=', accountId)
    )
    .where((eb) =>
      eb.or([eb('original', '=', path), eb('thumbnail', '=', path)])
    )
    .limit(1)
    .executeTakeFirst()
  return Boolean(row)
}

export const accountExportQueries = {
  getAccountExportAccount,
  getAccountExportActors,
  getAccountExportRows,
  ownsAccountExportMediaPath
}
