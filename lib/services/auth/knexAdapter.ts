import { CleanedWhere, createAdapterFactory } from 'better-auth/adapters'
import { Knex } from 'knex'

import { recordWeeklyLoginSafely } from '@/lib/database/sql/instanceActivity'
import { detachOAuthTokensFromSessions } from '@/lib/database/sql/utils/detachOAuthTokensFromSessions'
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
      case 'eq':
        query = query[method](`${tableName}.${field}`, '=', value)
        break
      case 'ne':
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
  db.transaction(async (trx) => {
    const lookup = trx(SESSIONS_TABLE)
    const scoped = where ? applyWhere(lookup, SESSIONS_TABLE, where) : lookup
    const rows = await scoped.select<{ id: string }[]>(`${SESSIONS_TABLE}.id`)
    // Delete by the resolved primary keys rather than re-running the (possibly
    // complex) where filter, so the detach and delete act on exactly the same
    // rows. `filter(Boolean)` guards against a stray empty id.
    const ids = rows.map((row) => row.id).filter(Boolean)
    if (ids.length === 0) return 0
    await detachOAuthTokensFromSessions(trx, ids)
    const deletedCount = await trx(SESSIONS_TABLE).whereIn('id', ids).delete()
    return deletedCount
  })

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
    adapter: ({ getModelName, getFieldName }) => {
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

        async findOne({ model, where, select }) {
          const tableName = getModelName(model)
          let query = select
            ? db(tableName).first(
                select.map(
                  (f) => `${tableName}.${getFieldName({ model, field: f })}`
                )
              )
            : db(tableName).first()
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          const row = await query
          return row ? (hydrateDateFields(row) as any) : null
        },

        async findMany({ model, where, limit, sortBy, offset, select }) {
          const tableName = getModelName(model)
          let query = select
            ? db(tableName).select(
                select.map(
                  (f) => `${tableName}.${getFieldName({ model, field: f })}`
                )
              )
            : db(tableName)
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          if (sortBy) {
            const sortField = getFieldName({ model, field: sortBy.field })
            query = query.orderBy(`${tableName}.${sortField}`, sortBy.direction)
          }
          if (limit !== undefined) query = query.limit(limit)
          if (offset !== undefined) query = query.offset(offset)
          const rows = await query
          return rows.map(hydrateDateFields) as any
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
        }
      }
    }
  })
