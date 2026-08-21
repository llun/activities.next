import type { BetterAuthDBSchema } from '@better-auth/core/db'
import {
  CleanedWhere,
  JoinConfig,
  createAdapterFactory
} from 'better-auth/adapters'
import { Knex } from 'knex'

import { recordWeeklyLoginSafely } from '@/lib/database/sql/instanceActivity'
import { deleteSessionsWithTokenDetach } from '@/lib/database/sql/utils/detachOAuthTokensFromSessions'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'

const escapeLikeValue = (value: unknown): string => {
  return String(value).replace(/[%_\\]/g, '\\$&')
}

// The `accounts` table holds better-auth's user records; `email` is the only
// email column it manages here. Better-auth resolves sign-in/sign-up by `email`
// through this adapter (it does NOT route through the SQL account methods), so
// normalization must also happen here to keep auth lookups and writes
// case-insensitive and consistent with stored values.
const ACCOUNTS_TABLE = 'accounts'
const EMAIL_FIELD = 'email'

const isAccountsEmail = (tableName: string, field: string): boolean =>
  tableName === ACCOUNTS_TABLE && field === EMAIL_FIELD

// Lowercase the value(s) of an `accounts.email` where-clause so exact-match
// lookups (and IN lists) hit the canonical stored form regardless of how the
// email was typed.
const normalizeWhereValue = (value: unknown): unknown => {
  if (typeof value === 'string') return normalizeEmail(value)
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === 'string' ? normalizeEmail(entry) : entry
    )
  }
  return value
}

// Lowercase `accounts.email` in any record being inserted/updated so writes
// going through better-auth (social/OAuth sign-up, email updates) store the
// canonical form. Returns a NEW object when normalization applies rather than
// mutating the caller's data — better-auth owns these objects and may rely on
// reference stability, so we never mutate them in place.
const normalizeEmailInData = (
  tableName: string,
  data: Record<string, unknown>
): Record<string, unknown> => {
  // Guard the better-auth boundary: only touch `accounts` rows that are real
  // (non-array) objects, so a malformed/primitive/array payload is passed
  // through untouched rather than risking unexpected property access.
  if (
    tableName !== ACCOUNTS_TABLE ||
    typeof data !== 'object' ||
    data === null ||
    Array.isArray(data)
  ) {
    return data
  }
  if (typeof data[EMAIL_FIELD] === 'string') {
    return { ...data, [EMAIL_FIELD]: normalizeEmail(data[EMAIL_FIELD]) }
  }
  return data
}

const supportsNativeBooleans = (db: Knex): boolean => {
  const clientName = String(db.client.config.client)
  return clientName !== 'better-sqlite3' && clientName !== 'sqlite3'
}

const hydrateDateFields = <T>(row: T): T => {
  if (!row || typeof row !== 'object' || row instanceof Date) {
    return row
  }

  const hydrated = { ...(row as Record<string, unknown>) }
  for (const [key, value] of Object.entries(hydrated)) {
    if (!key.endsWith('At')) continue
    if (value === null || value === undefined || value instanceof Date) {
      continue
    }

    const date = new Date(getCompatibleTime(value as string | number))
    if (Number.isNaN(date.getTime())) continue

    hydrated[key] = date
  }

  return hydrated as T
}

const getStringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const getSessionAccountId = (
  record: Record<string, unknown>,
  model: string
): string | null => {
  const userId = getStringValue(record.userId) ?? getStringValue(record.user_id)
  const accountId = getStringValue(record.accountId)

  if (model === 'session') {
    return userId ?? accountId
  }

  return accountId ?? userId
}

const getSessionCreatedAt = (record: Record<string, unknown>): Date => {
  const createdAt = record.createdAt
  if (createdAt instanceof Date && !Number.isNaN(createdAt.getTime())) {
    return createdAt
  }

  if (typeof createdAt === 'string' || typeof createdAt === 'number') {
    const parsed = new Date(getCompatibleTime(createdAt))
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  return new Date()
}

const applyWhere = (
  query: Knex.QueryBuilder,
  tableName: string,
  where: CleanedWhere[]
) => {
  for (const clause of where) {
    const { field, operator, connector } = clause
    // Normalizing only changes string/string[] email values to lowercase, which
    // preserves the original value type — cast back so knex's overloads resolve.
    const value = (
      isAccountsEmail(tableName, field)
        ? normalizeWhereValue(clause.value)
        : clause.value
    ) as typeof clause.value
    const method = connector === 'OR' ? 'orWhere' : 'where'

    switch (operator) {
      // SQL's null is not equal to anything, itself included, so `= NULL` and
      // `<> NULL` match no row on either backend. better-auth relies on an
      // `eq null` guard for real decisions — refresh-token rotation and
      // revocation both hinge on `{ field: 'revoked', operator: 'eq', value:
      // null }` — and rendering that literally turns "not yet revoked" into
      // "never matches", which reads back as an invalid refresh token.
      case 'eq':
        if (value === null) {
          query = query[method === 'orWhere' ? 'orWhereNull' : 'whereNull'](
            `${tableName}.${field}`
          )
          break
        }
        query = query[method](`${tableName}.${field}`, '=', value)
        break
      case 'ne':
        if (value === null) {
          query = query[
            method === 'orWhere' ? 'orWhereNotNull' : 'whereNotNull'
          ](`${tableName}.${field}`)
          break
        }
        query = query[method](`${tableName}.${field}`, '<>', value)
        break
      case 'gt':
        query = query[method](`${tableName}.${field}`, '>', value)
        break
      case 'gte':
        query = query[method](`${tableName}.${field}`, '>=', value)
        break
      case 'lt':
        query = query[method](`${tableName}.${field}`, '<', value)
        break
      case 'lte':
        query = query[method](`${tableName}.${field}`, '<=', value)
        break
      case 'in':
        query = query[method === 'orWhere' ? 'orWhereIn' : 'whereIn'](
          `${tableName}.${field}`,
          Array.isArray(value) ? value : [value]
        )
        break
      case 'not_in':
        query = query[method === 'orWhere' ? 'orWhereNotIn' : 'whereNotIn'](
          `${tableName}.${field}`,
          Array.isArray(value) ? value : [value]
        )
        break
      case 'contains': {
        const escaped = escapeLikeValue(value)
        const rawMethod = connector === 'OR' ? 'orWhereRaw' : 'whereRaw'
        query = query[rawMethod]("?? like ? escape '\\'", [
          `${tableName}.${field}`,
          `%${escaped}%`
        ])
        break
      }
      case 'starts_with': {
        const escaped = escapeLikeValue(value)
        const rawMethod = connector === 'OR' ? 'orWhereRaw' : 'whereRaw'
        query = query[rawMethod]("?? like ? escape '\\'", [
          `${tableName}.${field}`,
          `${escaped}%`
        ])
        break
      }
      case 'ends_with': {
        const escaped = escapeLikeValue(value)
        const rawMethod = connector === 'OR' ? 'orWhereRaw' : 'whereRaw'
        query = query[rawMethod]("?? like ? escape '\\'", [
          `${tableName}.${field}`,
          `%${escaped}`
        ])
        break
      }
      default:
        throw new Error(`Unsupported where operator: ${operator}`)
    }
  }
  return query
}

// AND the caller's predicate onto a statement that already carries a clause of
// its own. `applyWhere` emits `orWhere` for `OR`-connected entries, which would
// otherwise re-associate against the surrounding clause, so the predicate is
// wrapped in its own parenthesised group.
const applyGroupedWhere = (
  query: Knex.QueryBuilder,
  tableName: string,
  where: CleanedWhere[]
) =>
  query.where((builder) => {
    applyWhere(builder, tableName, where)
  })

// Better-auth asks for related rows through the `join` argument on `findOne`
// and `findMany` once `advanced.database.joins` is on (`{ user: true }` on a session
// lookup, and so on). The factory transforms that into a `JoinConfig` keyed by
// the joined table name, with the joining columns already mapped to real column
// names, e.g. for this instance's `user`/`session` model mapping:
//
//   { accounts: { on: { from: 'accountId', to: 'id' }, limit: 1,
//                 relation: 'one-to-one' } }
//
// The adapter must return each base row with the joined data nested under that
// same table-name key. On better-auth 1.6.x the flag is an assertion, not a
// request: once it is set the factory reads `row[tableName]` and does NOT fall
// back to separate queries if the key is missing — a missing key silently
// becomes `user: null`, which `findSession` reports as "no session". So every
// join shape this adapter is handed has to be answered here, natively where a
// single statement can do it and with a follow-up query where it cannot.
type JoinEntry = JoinConfig[string]

// A joined column is selected as `__j<n>_<column>` so it cannot collide with a
// base column of the same name — `sessions` and `accounts` share `id`,
// `createdAt` and `updatedAt`, and selecting both tables unaliased would
// overwrite the session's own id with the account's. The prefix is kept short on
// purpose: PostgreSQL truncates identifiers at 63 bytes, and a truncated alias
// would merge two columns into one.
const joinColumnAlias = (index: number, column: string) =>
  `__j${index}_${column}`

// Resolve the columns to select for a joined table from better-auth's own
// schema. This is exactly the set the factory's output transform reads back
// (it iterates the model's schema fields plus `id` and drops everything else),
// so selecting them is lossless compared with the `SELECT *` the fallback path
// would have run — while keeping app-only columns such as `accounts.privateKey`
// out of the result. Returns null when the table is not in the schema, which
// sends the join down the follow-up-query path instead.
const getJoinedColumns = (
  schema: BetterAuthDBSchema | undefined,
  tableName: string
): string[] | null => {
  const model = Object.values(schema ?? {}).find(
    (definition) => definition.modelName === tableName
  )
  if (!model) return null

  const columns = new Set<string>(['id'])
  for (const [field, attributes] of Object.entries(model.fields)) {
    columns.add(attributes.fieldName || field)
  }
  return [...columns]
}

const isOneToOne = (entry: JoinEntry) => entry.relation === 'one-to-one'

type PlannedJoin = {
  tableName: string
  entry: JoinEntry
  // Set for joins answered by a LEFT JOIN in the base statement.
  columns?: string[]
  index: number
}

// Split the requested joins into the ones a LEFT JOIN can answer inside the base
// statement and the ones that need their own query.
//
// Only `one-to-one` is joined inline. A `one-to-many` join carries a per-parent
// `limit` (100 by default) that plain SQL cannot express without window
// functions — and on `findMany` a one-to-many LEFT JOIN would also multiply the
// base rows, breaking `limit`/`offset` and the row count the caller expects.
const planJoins = (
  join: JoinConfig | undefined,
  schema: BetterAuthDBSchema | undefined
): { inline: PlannedJoin[]; deferred: PlannedJoin[] } => {
  const inline: PlannedJoin[] = []
  const deferred: PlannedJoin[] = []
  if (!join) return { inline, deferred }

  let index = 0
  for (const [tableName, entry] of Object.entries(join)) {
    const columns = isOneToOne(entry)
      ? getJoinedColumns(schema, tableName)
      : null
    if (columns && columns.length > 0) {
      inline.push({ tableName, entry, columns, index })
      index += 1
      continue
    }
    deferred.push({ tableName, entry, index })
  }
  return { inline, deferred }
}

// Add the LEFT JOINs and their aliased column selections to a base query.
// `select` is the caller's base-column selection (already mapped to column
// names); without one the base table contributes `<table>.*` so joined columns
// stay out of the top level.
const applyInlineJoins = (
  query: Knex.QueryBuilder,
  tableName: string,
  inline: PlannedJoin[],
  select: string[] | undefined
) => {
  if (inline.length === 0) return query

  const columns: string[] = select?.length
    ? select.map((field) => `${tableName}.${field}`)
    : [`${tableName}.*`]

  for (const {
    tableName: joinTable,
    entry,
    columns: joinColumns,
    index
  } of inline) {
    query = query.leftJoin(
      joinTable,
      `${tableName}.${entry.on.from}`,
      `${joinTable}.${entry.on.to}`
    )
    for (const column of joinColumns ?? []) {
      columns.push(
        `${joinTable}.${column} as ${joinColumnAlias(index, column)}`
      )
    }
  }

  return query.select(columns)
}

// Lift the `__j<n>_` columns of a flat joined row into a nested object under the
// joined table name. A LEFT JOIN that matched nothing produces all-null columns,
// which is indistinguishable from a matched row only by looking at `id` — a real
// row always has one — so that is what decides null vs object.
const extractInlineJoins = (
  row: Record<string, unknown>,
  inline: PlannedJoin[]
): Record<string, unknown> => {
  if (inline.length === 0) return hydrateDateFields(row)

  const base = { ...row }
  const joined: Record<string, unknown> = {}

  for (const { tableName, columns, index } of inline) {
    const record: Record<string, unknown> = {}
    for (const column of columns ?? []) {
      const alias = joinColumnAlias(index, column)
      record[column] = base[alias]
      delete base[alias]
    }
    joined[tableName] = record.id == null ? null : hydrateDateFields(record)
  }

  return { ...hydrateDateFields(base), ...joined }
}

// Answer the joins that could not be folded into the base statement with one
// extra query each, then attach the results to the rows they belong to. This is
// the same shape as the factory's own fallback, re-implemented here because that
// fallback is what 1.7 falls back TO when the adapter leaves a join
// unanswered; answering it here keeps the single-statement path.
const applyDeferredJoins = async (
  db: Knex,
  rows: Record<string, unknown>[],
  deferred: PlannedJoin[]
) => {
  if (deferred.length === 0 || rows.length === 0) return rows

  for (const { tableName, entry } of deferred) {
    const { from, to } = entry.on
    const oneToOne = isOneToOne(entry)
    const parentValues = [
      ...new Set(
        rows
          .map((row) => row[from])
          .filter((value) => value !== null && value !== undefined)
      )
    ]

    const related = parentValues.length
      ? await db(tableName).whereIn(`${tableName}.${to}`, parentValues)
      : []

    const byParent = new Map<unknown, Record<string, unknown>[]>()
    for (const record of related) {
      const key = record[to]
      const bucket = byParent.get(key)
      if (bucket) bucket.push(record)
      else byParent.set(key, [record])
    }

    for (const row of rows) {
      const matches = byParent.get(row[from]) ?? []
      if (oneToOne) {
        row[tableName] = matches.length ? hydrateDateFields(matches[0]) : null
        continue
      }
      // `limit` is per parent row, which is why this cannot be a single joined
      // statement: it bounds each bucket, not the result set.
      const limit = entry.limit ?? matches.length
      row[tableName] = matches.slice(0, limit).map(hydrateDateFields)
    }
  }

  return rows
}

const SESSIONS_TABLE = 'sessions'

// Deleting a session whose grants minted OAuth tokens fails on PostgreSQL's
// `oauthAccessToken`/`oauthRefreshToken` `sessionId` foreign keys, so detach
// those tokens before removing the session (see `detachOAuthTokensFromSessions`).
// Covers every better-auth session removal — sign-out, "revoke session", and
// expired-session cleanup — that flows through the adapter's delete methods.
// Wrapped in a transaction so a failure can't leave tokens detached from a
// session that still exists. Returns the number of sessions deleted.
const deleteSessionsDetachingOAuthTokens = (
  db: Knex,
  where: CleanedWhere[] | undefined
): Promise<number> =>
  db.transaction((trx) =>
    deleteSessionsWithTokenDetach(trx, (query) =>
      where ? applyWhere(query, SESSIONS_TABLE, where) : query
    )
  )

type KnexAdapterOptions = {
  // The WebAuthn rpID this auth instance serves. better-auth's passkey plugin
  // does not persist the rpID a credential was created with (its schema can't be
  // extended), so we stamp it onto the row at creation time. Each per-host auth
  // instance constructs its adapter with its own rpID, making passkeys
  // per-domain. See `lib/services/auth/auth.ts`.
  passkeyRpID?: string
}

const PASSKEY_TABLE = 'passkey'

export const knexAdapter = (db: Knex, options: KnexAdapterOptions = {}) =>
  createAdapterFactory({
    config: {
      adapterId: 'knex',
      supportsNumericIds: false,
      supportsBooleans: supportsNativeBooleans(db)
    },
    adapter: ({ getModelName, getFieldName, schema }) => {
      // The factory's createAdapterFactory already transforms `where` clauses
      // and `data` objects (via transformWhereClause and transformInput) before
      // passing them to the adapter. Field names in `where` and `data` are
      // already DB column names. Only `select` and `sortBy.field` arrive as
      // schema field names and need mapping via getFieldName.

      return {
        async create({ data, model }) {
          const tableName = getModelName(model)
          const record = normalizeEmailInData(
            tableName,
            data as Record<string, unknown>
          )
          const id = record.id as string

          // Stamp the serving domain onto new passkeys so the settings page can
          // show which domain each credential belongs to. `rpID` is not part of
          // better-auth's passkey schema, so it never arrives in `data`.
          if (
            tableName === PASSKEY_TABLE &&
            options.passkeyRpID &&
            record.rpID == null
          ) {
            record.rpID = options.passkeyRpID
          }

          if (model === 'session' || tableName === 'sessions') {
            const accountId = getSessionAccountId(record, model)
            const createdAt = getSessionCreatedAt(record)
            if (accountId && tableName === 'sessions') {
              record.accountId = accountId
            } else if (tableName !== 'sessions') {
              delete record.accountId
            }
            await db(tableName).insert(record)
            const row = await db(tableName).where(`${tableName}.id`, id).first()
            if (!row) throw new Error('Failed to create record')
            await recordWeeklyLoginSafely(db, accountId, createdAt)
            return hydrateDateFields(row) as any
          }

          await db(tableName).insert(record)
          const row = await db(tableName).where(`${tableName}.id`, id).first()
          if (!row) throw new Error('Failed to create record')
          return hydrateDateFields(row) as any
        },

        async findOne({ model, where, select, join }) {
          const tableName = getModelName(model)
          const columns = select?.map((f) => getFieldName({ model, field: f }))
          const { inline, deferred } = planJoins(join, schema)

          let query = inline.length
            ? applyInlineJoins(db(tableName), tableName, inline, columns)
            : columns
              ? db(tableName).select(
                  columns.map((column) => `${tableName}.${column}`)
                )
              : db(tableName)
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          const row = await query.first()
          if (!row) return null

          const withInline = extractInlineJoins(row, inline)
          if (!deferred.length) return withInline as any

          const [joined] = await applyDeferredJoins(db, [withInline], deferred)
          return joined as any
        },

        async findMany({ model, where, limit, sortBy, offset, select, join }) {
          const tableName = getModelName(model)
          const columns = select?.map((f) => getFieldName({ model, field: f }))
          const { inline, deferred } = planJoins(join, schema)

          let query = inline.length
            ? applyInlineJoins(db(tableName), tableName, inline, columns)
            : columns
              ? db(tableName).select(
                  columns.map((column) => `${tableName}.${column}`)
                )
              : db(tableName)
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          if (sortBy) {
            const sortField = getFieldName({ model, field: sortBy.field })
            query = query.orderBy(`${tableName}.${sortField}`, sortBy.direction)
          }
          // Safe alongside the inline joins because only `one-to-one` is joined
          // inline: those keep the result at one row per base row, so `limit`
          // and `offset` still count base rows.
          if (limit !== undefined) query = query.limit(limit)
          if (offset !== undefined) query = query.offset(offset)
          const rows = await query

          const withInline = rows.map((row: Record<string, unknown>) =>
            extractInlineJoins(row, inline)
          )
          return (await applyDeferredJoins(db, withInline, deferred)) as any
        },

        async count({ model, where }) {
          const tableName = getModelName(model)
          let query = db(tableName).count('* as count')
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          const result = await query.first()
          return Number(result?.count ?? 0)
        },

        async update({ model, where, update: updateData }) {
          const tableName = getModelName(model)
          let idQuery = db(tableName).first('id')
          if (where) {
            idQuery = applyWhere(idQuery, tableName, where)
          }
          const existing = await idQuery
          if (!existing) return null
          const id = existing.id
          const update = normalizeEmailInData(
            tableName,
            updateData as Record<string, unknown>
          )
          await db(tableName).where(`${tableName}.id`, id).update(update)
          const row = await db(tableName).where(`${tableName}.id`, id).first()
          return row ? (hydrateDateFields(row) as any) : null
        },

        async updateMany({ model, where, update: updateData }) {
          const tableName = getModelName(model)
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          const update = normalizeEmailInData(
            tableName,
            updateData as Record<string, unknown>
          )
          const result = await query.update(update)
          return result
        },

        async delete({ model, where }) {
          const tableName = getModelName(model)
          if (tableName === SESSIONS_TABLE) {
            await deleteSessionsDetachingOAuthTokens(db, where)
            return
          }
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          await query.delete()
        },

        async deleteMany({ model, where }) {
          const tableName = getModelName(model)
          if (tableName === SESSIONS_TABLE) {
            return deleteSessionsDetachingOAuthTokens(db, where)
          }
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          const result = await query.delete()
          return result
        },
        // Atomically delete one matching row and hand it back. better-auth
        // consumes single-use credentials (verification tokens, OAuth
        // authorization codes, device codes) through this, so the guarantee it
        // needs is that exactly one of N concurrent callers receives the row.
        //
        // The DELETE, not the SELECT, is what provides that: it is scoped to
        // the row's own primary key AND re-applies the caller's predicate, so a
        // racing caller finds nothing left to match. PostgreSQL makes the loser
        // block on the row lock and then re-evaluate against the committed
        // state, and SQLite serialises writers outright; either way the loser's
        // statement reports zero rows and this returns null.
        async consumeOne({ model, where }) {
          const tableName = getModelName(model)
          // An empty predicate would consume an arbitrary credential, so it
          // matches nothing instead. The factory does not guard this itself.
          if (!where?.length) return null

          return db.transaction(async (trx) => {
            const row = await applyWhere(
              trx(tableName),
              tableName,
              where
            ).first()
            if (!row) return null

            const scope = (query: Knex.QueryBuilder) =>
              applyGroupedWhere(
                query.where(`${tableName}.id`, row.id),
                tableName,
                where
              )

            // Sessions carry OAuth-token foreign keys that have to be detached
            // first; better-auth never consumes one today, but routing through
            // the shared helper keeps that from becoming a PostgreSQL 23503 if
            // it ever does.
            const deleted =
              tableName === SESSIONS_TABLE
                ? await deleteSessionsWithTokenDetach(trx, scope)
                : await scope(trx(tableName)).delete()

            return deleted > 0 ? (hydrateDateFields(row) as any) : null
          })
        },

        // Atomically apply signed deltas to one matching row, with `where`
        // acting as both selector and guard: better-auth uses this to decrement
        // a remaining-uses counter only while it is still positive, and to bump
        // failed-attempt counters. Re-applying the predicate in the UPDATE is
        // again what makes the guard hold under concurrency — a racing caller
        // re-evaluates it after the winner commits and updates nothing.
        //
        // `RETURNING` gives the post-update row in the same statement on both
        // supported backends (PostgreSQL natively, SQLite since 3.35), so the
        // value reported is the one this call produced rather than whatever a
        // later writer left behind.
        async incrementOne({ model, where, increment, set }) {
          const tableName = getModelName(model)
          if (!where?.length) return null

          let idQuery = db(tableName).first('id')
          idQuery = applyWhere(idQuery, tableName, where)
          const existing = await idQuery
          if (!existing) return null

          const update: Record<string, unknown> = {
            ...normalizeEmailInData(
              tableName,
              (set ?? {}) as Record<string, unknown>
            )
          }
          for (const [field, delta] of Object.entries(increment)) {
            update[field] = db.raw('?? + ?', [field, delta])
          }

          const rows = await applyGroupedWhere(
            db(tableName).where(`${tableName}.id`, existing.id),
            tableName,
            where
          )
            .update(update)
            .returning('*')

          const row = rows[0]
          return row ? (hydrateDateFields(row) as any) : null
        }
      }
    }
  })
