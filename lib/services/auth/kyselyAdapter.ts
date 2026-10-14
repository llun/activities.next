import type { BetterAuthDBSchema } from '@better-auth/core/db'
import {
  CleanedWhere,
  JoinConfig,
  createAdapterFactory
} from 'better-auth/adapters'
import {
  type Expression,
  type ExpressionBuilder,
  type Kysely,
  type SqlBool,
  type Transaction,
  sql
} from 'kysely'

import { deleteSessionsWithTokenDetach } from '@/lib/database/domains/account/sessions'
import { recordWeeklyLoginSafely } from '@/lib/database/domains/instanceActivity/queries'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { getDialectName } from '@/lib/database/kysely/dialect'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'

// better-auth's tables are addressed by name at run time (the factory hands
// the adapter a model name it maps to a table), so they are typed as `any`
// rather than through the generated `DB` interface.
type DynamicDB = any
/** A Kysely instance over better-auth's tables, addressed by name. */
export type AuthKysely = Kysely<DynamicDB>
type AuthDb = AuthKysely | Transaction<DynamicDB>
type AuthExpressionBuilder = ExpressionBuilder<DynamicDB, string>
type Row = Record<string, unknown>

// The domain helpers this adapter shares with the account queries take the
// generated-schema `Db`; the instance is the same one either way.
const asDb = (db: AuthDb): Db => db as unknown as Db

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

const supportsNativeBooleans = (db: AuthDb): boolean =>
  getDialectName(asDb(db)) !== 'sqlite'

// The columns better-auth declares as `type: 'date'`, per table. Hydration goes
// by this rather than by an `…At` name: `oauthAccessToken.revoked`,
// `oauthRefreshToken.revoked`, `oauthRefreshToken.authTime` and
// `twoFactor.lockedUntil` are dates too. The Kysely driver returns every
// timestamp as epoch milliseconds on both backends, and the factory passes
// date values through unchanged (it converts strings to dates only when
// `supportsDates` is false, which it is not here), so without this
// better-auth would see numbers.
type DateColumns = (tableName: string) => ReadonlySet<string>

const createDateColumns = (
  schema: BetterAuthDBSchema | undefined
): DateColumns => {
  const byTable = new Map<string, Set<string>>()
  for (const [model, definition] of Object.entries(schema ?? {})) {
    const tableName = definition.modelName || model
    const columns = byTable.get(tableName) ?? new Set<string>()
    for (const [field, attributes] of Object.entries(definition.fields)) {
      if (attributes.type === 'date') columns.add(attributes.fieldName || field)
    }
    byTable.set(tableName, columns)
  }
  const none = new Set<string>()
  return (tableName) => byTable.get(tableName) ?? none
}

const hydrateDateFields = <T>(row: T, dateColumns: ReadonlySet<string>): T => {
  if (!row || typeof row !== 'object' || row instanceof Date) {
    return row
  }

  const hydrated = { ...(row as Row) }
  for (const [key, value] of Object.entries(hydrated)) {
    if (!dateColumns.has(key)) continue
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

const TRUE = sql<SqlBool>`1 = 1`
const FALSE = sql<SqlBool>`1 = 0`

// Bound values may not be `undefined`: what the database would make of one
// differs by driver, and a comparison against it never means anything, so they
// are refused.
const assertDefined = (tableName: string, field: string, value: unknown) => {
  const values = Array.isArray(value) ? value : [value]
  if (values.some((entry) => entry === undefined)) {
    throw new Error(
      `Undefined value in the where clause on ${tableName}.${field}`
    )
  }
}

const like = (column: string, pattern: string) =>
  sql<SqlBool>`${sql.ref(column)} like ${pattern} escape '\\'`

const toCondition = (
  eb: AuthExpressionBuilder,
  tableName: string,
  clause: CleanedWhere
): Expression<SqlBool> => {
  const { field, operator } = clause
  const column = `${tableName}.${field}`
  const value = isAccountsEmail(tableName, field)
    ? normalizeWhereValue(clause.value)
    : clause.value

  switch (operator) {
    // SQL's null is not equal to anything, itself included, so `= NULL` and
    // `<> NULL` match no row on either backend. better-auth relies on an
    // `eq null` guard for real decisions — refresh-token rotation and
    // revocation both hinge on `{ field: 'revoked', operator: 'eq', value:
    // null }` — and rendering that literally turns "not yet revoked" into
    // "never matches", which reads back as an invalid refresh token.
    case 'eq':
      if (value === null) return eb(column, 'is', null)
      assertDefined(tableName, field, value)
      return eb(column, '=', value)
    case 'ne':
      if (value === null) return eb(column, 'is not', null)
      assertDefined(tableName, field, value)
      return eb(column, '<>', value)
    case 'gt':
      assertDefined(tableName, field, value)
      return eb(column, '>', value)
    case 'gte':
      assertDefined(tableName, field, value)
      return eb(column, '>=', value)
    case 'lt':
      assertDefined(tableName, field, value)
      return eb(column, '<', value)
    case 'lte':
      assertDefined(tableName, field, value)
      return eb(column, '<=', value)
    // An empty list matches nothing (`in`) or everything (`not in`); `in ()`
    // itself is a syntax error on PostgreSQL.
    case 'in': {
      const values = Array.isArray(value) ? value : [value]
      assertDefined(tableName, field, values)
      return values.length ? eb(column, 'in', values) : FALSE
    }
    case 'not_in': {
      const values = Array.isArray(value) ? value : [value]
      assertDefined(tableName, field, values)
      return values.length ? eb(column, 'not in', values) : TRUE
    }
    case 'contains':
      return like(column, `%${escapeLikeValue(value)}%`)
    case 'starts_with':
      return like(column, `${escapeLikeValue(value)}%`)
    case 'ends_with':
      return like(column, `%${escapeLikeValue(value)}`)
    default:
      throw new Error(`Unsupported where operator: ${operator}`)
  }
}

// The caller's predicate as one expression. better-auth connects each clause to
// the previous one with its `connector`, read left to right with SQL's usual
// precedence (AND binds tighter than OR): `a AND b OR c AND d` is
// `(a AND b) OR (c AND d)`. So a clause connected with OR starts a new AND
// group; the first clause's connector is ignored. The result is parenthesised
// wherever it is combined with another condition, so an OR in it can never
// re-associate against a clause of the adapter's own.
const buildWhere = (
  eb: AuthExpressionBuilder,
  tableName: string,
  where: CleanedWhere[]
): Expression<SqlBool> => {
  const groups: Expression<SqlBool>[][] = []
  where.forEach((clause, index) => {
    const condition = toCondition(eb, tableName, clause)
    if (index === 0 || clause.connector === 'OR') groups.push([condition])
    else groups[groups.length - 1].push(condition)
  })
  return eb.or(groups.map((group) => eb.and(group)))
}

const hasWhere = (where: CleanedWhere[] | undefined): where is CleanedWhere[] =>
  Boolean(where?.length)

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

// The base statement of `findOne` / `findMany`: the caller's base-column
// selection (already mapped to column names) or every base column, plus a LEFT
// JOIN and the aliased columns of each inline join. With joins and no
// selection the base table contributes `<table>.*`, so joined columns stay out
// of the top level.
const selectBase = (
  db: AuthDb,
  tableName: string,
  inline: PlannedJoin[],
  select: string[] | undefined
) => {
  let query = db.selectFrom(tableName)
  query = select?.length
    ? query.select(select.map((column) => `${tableName}.${column}`))
    : inline.length
      ? query.selectAll(tableName)
      : query.selectAll()

  for (const {
    tableName: joinTable,
    entry,
    columns: joinColumns,
    index
  } of inline) {
    query = query
      .leftJoin(
        joinTable,
        `${tableName}.${entry.on.from}`,
        `${joinTable}.${entry.on.to}`
      )
      .select((eb) =>
        (joinColumns ?? []).map((column) =>
          eb.ref(`${joinTable}.${column}`).as(joinColumnAlias(index, column))
        )
      )
  }

  return query
}

// Lift the `__j<n>_` columns of a flat joined row into a nested object under the
// joined table name. A LEFT JOIN that matched nothing produces all-null columns,
// which is indistinguishable from a matched row only by looking at `id` — a real
// row always has one — so that is what decides null vs object.
const extractInlineJoins = (
  row: Row,
  tableName: string,
  inline: PlannedJoin[],
  dateColumns: DateColumns
): Row => {
  if (inline.length === 0) return hydrateDateFields(row, dateColumns(tableName))

  const base = { ...row }
  const joined: Row = {}

  for (const { tableName: joinTable, columns, index } of inline) {
    const record: Row = {}
    for (const column of columns ?? []) {
      const alias = joinColumnAlias(index, column)
      record[column] = base[alias]
      delete base[alias]
    }
    joined[joinTable] =
      record.id == null
        ? null
        : hydrateDateFields(record, dateColumns(joinTable))
  }

  return { ...hydrateDateFields(base, dateColumns(tableName)), ...joined }
}

// Answer the joins that could not be folded into the base statement with one
// extra query each, then attach the results to the rows they belong to. This is
// the same shape as the factory's own fallback, re-implemented here because that
// fallback is what 1.7 falls back TO when the adapter leaves a join
// unanswered; answering it here keeps the single-statement path.
const applyDeferredJoins = async (
  db: AuthDb,
  rows: Row[],
  deferred: PlannedJoin[],
  dateColumns: DateColumns
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

    const related: Row[] = parentValues.length
      ? await db
          .selectFrom(tableName)
          .selectAll()
          .where(`${tableName}.${to}`, 'in', parentValues)
          .execute()
      : []

    const byParent = new Map<unknown, Row[]>()
    for (const record of related) {
      const key = record[to]
      const bucket = byParent.get(key)
      if (bucket) bucket.push(record)
      else byParent.set(key, [record])
    }

    const hydrate = (record: Row) =>
      hydrateDateFields(record, dateColumns(tableName))
    for (const row of rows) {
      const matches = byParent.get(row[from]) ?? []
      if (oneToOne) {
        row[tableName] = matches.length ? hydrate(matches[0]) : null
        continue
      }
      // `limit` is per parent row, which is why this cannot be a single joined
      // statement: it bounds each bucket, not the result set.
      const limit = entry.limit ?? matches.length
      row[tableName] = matches.slice(0, limit).map(hydrate)
    }
  }

  return rows
}

const SESSIONS_TABLE = 'sessions'

// Deleting a session whose grants minted OAuth tokens fails on PostgreSQL's
// `oauthAccessToken`/`oauthRefreshToken` `sessionId` foreign keys, so detach
// those tokens before removing the session (see `deleteSessionsWithTokenDetach`
// in lib/database/domains/account/sessions.ts). Covers every better-auth
// session removal — sign-out, "revoke session", and expired-session cleanup —
// that flows through the adapter's delete methods. Run in a transaction so a
// failure can't leave tokens detached from a session that still exists.
// Returns the number of sessions deleted.
const deleteSessionsDetachingOAuthTokens = (
  db: AuthDb,
  where: CleanedWhere[] | undefined
): Promise<number> =>
  inTransaction(asDb(db), (trx) =>
    deleteSessionsWithTokenDetach(trx, (eb) =>
      hasWhere(where) ? buildWhere(eb, SESSIONS_TABLE, where) : TRUE
    )
  )

type KyselyAdapterOptions = {
  // The WebAuthn rpID this auth instance serves. better-auth's passkey plugin
  // does not persist the rpID a credential was created with (its schema can't be
  // extended), so we stamp it onto the row at creation time. Each per-host auth
  // instance constructs its adapter with its own rpID, making passkeys
  // per-domain. See `lib/services/auth/auth.ts`.
  passkeyRpID?: string
}

const PASSKEY_TABLE = 'passkey'

export const kyselyAdapter = (
  db: AuthKysely,
  options: KyselyAdapterOptions = {}
) =>
  createAdapterFactory({
    config: {
      adapterId: 'kysely',
      supportsNumericIds: false,
      supportsBooleans: supportsNativeBooleans(db)
    },
    adapter: ({ getModelName, getFieldName, schema }) => {
      // The factory's createAdapterFactory already transforms `where` clauses
      // and `data` objects (via transformWhereClause and transformInput) before
      // passing them to the adapter. Field names in `where` and `data` are
      // already DB column names. Only `select` and `sortBy.field` arrive as
      // schema field names and need mapping via getFieldName.
      const dateColumns = createDateColumns(schema)
      const hydrate = (tableName: string, row: Row) =>
        hydrateDateFields(row, dateColumns(tableName))

      const findById = (executor: AuthDb, tableName: string, id: unknown) =>
        executor
          .selectFrom(tableName)
          .selectAll()
          .where(`${tableName}.id`, '=', id)
          .limit(1)
          .executeTakeFirst() as Promise<Row | undefined>

      // The id of the first row the predicate matches (`limit 1`).
      const findFirstId = async (
        executor: AuthDb,
        tableName: string,
        where: CleanedWhere[] | undefined
      ) => {
        let query = executor.selectFrom(tableName).select(`${tableName}.id`)
        if (hasWhere(where)) {
          query = query.where((eb) => buildWhere(eb, tableName, where))
        }
        const row = (await query.limit(1).executeTakeFirst()) as Row | undefined
        return row
      }

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
            await db.insertInto(tableName).values(record).execute()
            const row = await findById(db, tableName, id)
            if (!row) throw new Error('Failed to create record')
            await recordWeeklyLoginSafely(asDb(db), accountId, createdAt)
            return hydrate(tableName, row) as any
          }

          await db.insertInto(tableName).values(record).execute()
          const row = await findById(db, tableName, id)
          if (!row) throw new Error('Failed to create record')
          return hydrate(tableName, row) as any
        },

        async findOne({ model, where, select, join }) {
          const tableName = getModelName(model)
          const columns = select?.map((f) => getFieldName({ model, field: f }))
          const { inline, deferred } = planJoins(join, schema)

          let query = selectBase(db, tableName, inline, columns)
          if (hasWhere(where)) {
            query = query.where((eb) => buildWhere(eb, tableName, where))
          }
          const row = (await query.limit(1).executeTakeFirst()) as
            Row | undefined
          if (!row) return null

          const withInline = extractInlineJoins(
            row,
            tableName,
            inline,
            dateColumns
          )
          if (!deferred.length) return withInline as any

          const [joined] = await applyDeferredJoins(
            db,
            [withInline],
            deferred,
            dateColumns
          )
          return joined as any
        },

        async findMany({ model, where, limit, sortBy, offset, select, join }) {
          const tableName = getModelName(model)
          const columns = select?.map((f) => getFieldName({ model, field: f }))
          const { inline, deferred } = planJoins(join, schema)

          let query = selectBase(db, tableName, inline, columns)
          if (hasWhere(where)) {
            query = query.where((eb) => buildWhere(eb, tableName, where))
          }
          if (sortBy) {
            const sortField = getFieldName({ model, field: sortBy.field })
            query = query.orderBy(`${tableName}.${sortField}`, sortBy.direction)
          }
          // Safe alongside the inline joins because only `one-to-one` is joined
          // inline: those keep the result at one row per base row, so `limit`
          // and `offset` still count base rows.
          if (limit !== undefined) query = query.limit(limit)
          if (offset !== undefined) {
            // SQLite only accepts OFFSET after a LIMIT; -1 is "no limit" there.
            if (limit === undefined && getDialectName(asDb(db)) === 'sqlite') {
              query = query.limit(-1)
            }
            query = query.offset(offset)
          }
          const rows = (await query.execute()) as Row[]

          const withInline = rows.map((row) =>
            extractInlineJoins(row, tableName, inline, dateColumns)
          )
          return (await applyDeferredJoins(
            db,
            withInline,
            deferred,
            dateColumns
          )) as any
        },

        async count({ model, where }) {
          const tableName = getModelName(model)
          let query = db
            .selectFrom(tableName)
            .select((eb) => eb.fn.countAll().as('count'))
          if (hasWhere(where)) {
            query = query.where((eb) => buildWhere(eb, tableName, where))
          }
          const result = (await query.limit(1).executeTakeFirst()) as
            Row | undefined
          return Number(result?.count ?? 0)
        },

        async update({ model, where, update: updateData }) {
          const tableName = getModelName(model)
          const existing = await findFirstId(db, tableName, where)
          if (!existing) return null
          const id = existing.id
          const update = normalizeEmailInData(
            tableName,
            updateData as Record<string, unknown>
          )
          await db
            .updateTable(tableName)
            .set(update)
            .where(`${tableName}.id`, '=', id)
            .execute()
          const row = await findById(db, tableName, id)
          return row ? (hydrate(tableName, row) as any) : null
        },

        async updateMany({ model, where, update: updateData }) {
          const tableName = getModelName(model)
          const update = normalizeEmailInData(
            tableName,
            updateData as Record<string, unknown>
          )
          let query = db.updateTable(tableName).set(update)
          if (hasWhere(where)) {
            query = query.where((eb) => buildWhere(eb, tableName, where))
          }
          const result = await query.executeTakeFirst()
          return Number(result.numUpdatedRows)
        },

        async delete({ model, where }) {
          const tableName = getModelName(model)
          if (tableName === SESSIONS_TABLE) {
            await deleteSessionsDetachingOAuthTokens(db, where)
            return
          }
          let query = db.deleteFrom(tableName)
          if (hasWhere(where)) {
            query = query.where((eb) => buildWhere(eb, tableName, where))
          }
          await query.execute()
        },

        async deleteMany({ model, where }) {
          const tableName = getModelName(model)
          if (tableName === SESSIONS_TABLE) {
            return deleteSessionsDetachingOAuthTokens(db, where)
          }
          let query = db.deleteFrom(tableName)
          if (hasWhere(where)) {
            query = query.where((eb) => buildWhere(eb, tableName, where))
          }
          const result = await query.executeTakeFirst()
          return Number(result.numDeletedRows)
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
          if (!hasWhere(where)) return null

          return inTransaction(asDb(db), async (dbTrx) => {
            const trx = dbTrx as unknown as AuthDb
            const row = (await trx
              .selectFrom(tableName)
              .selectAll()
              .where((eb) => buildWhere(eb, tableName, where))
              .limit(1)
              .executeTakeFirst()) as Row | undefined
            if (!row) return null

            const scope = (eb: AuthExpressionBuilder) =>
              eb.and([
                eb(`${tableName}.id`, '=', row.id),
                buildWhere(eb, tableName, where)
              ])

            // Sessions carry OAuth-token foreign keys that have to be detached
            // first; better-auth never consumes one today, but routing through
            // the shared helper keeps that from becoming a PostgreSQL 23503 if
            // it ever does.
            const deleted =
              tableName === SESSIONS_TABLE
                ? await deleteSessionsWithTokenDetach(dbTrx, scope)
                : Number(
                    (
                      await trx
                        .deleteFrom(tableName)
                        .where(scope)
                        .executeTakeFirst()
                    ).numDeletedRows
                  )

            return deleted > 0 ? (hydrate(tableName, row) as any) : null
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
          if (!hasWhere(where)) return null

          const existing = await findFirstId(db, tableName, where)
          if (!existing) return null

          const update: Record<string, unknown> = {
            ...normalizeEmailInData(
              tableName,
              (set ?? {}) as Record<string, unknown>
            )
          }
          for (const [field, delta] of Object.entries(increment)) {
            update[field] = sql`${sql.ref(field)} + ${delta}`
          }

          const row = (await db
            .updateTable(tableName)
            .set(update)
            .where((eb) =>
              eb.and([
                eb(`${tableName}.id`, '=', existing.id),
                buildWhere(eb, tableName, where)
              ])
            )
            .returningAll()
            .executeTakeFirst()) as Row | undefined

          return row ? (hydrate(tableName, row) as any) : null
        }
      }
    }
  })
