import { CleanedWhere, createAdapterFactory } from 'better-auth/adapters'
import { Knex } from 'knex'

import { recordWeeklyLogin } from '@/lib/database/sql/instanceActivity'

const escapeLikeValue = (value: unknown): string => {
  return String(value).replace(/[%_\\]/g, '\\$&')
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

    const date = new Date(value as string | number)
    if (Number.isNaN(date.getTime())) continue

    hydrated[key] = date
  }

  return hydrated as T
}

const getSessionAccountId = (
  record: Record<string, unknown>
): string | null => {
  const accountId = record.accountId ?? record.userId ?? record.user_id
  return typeof accountId === 'string' && accountId.length > 0
    ? accountId
    : null
}

const getSessionCreatedAt = (record: Record<string, unknown>): Date => {
  const createdAt = record.createdAt
  if (createdAt instanceof Date && !Number.isNaN(createdAt.getTime())) {
    return createdAt
  }

  if (typeof createdAt === 'string' || typeof createdAt === 'number') {
    const parsed = new Date(createdAt)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  return new Date()
}

const applyWhere = (
  query: Knex.QueryBuilder,
  model: string,
  where: CleanedWhere[]
) => {
  for (const clause of where) {
    const { field, value, operator, connector } = clause
    const method = connector === 'OR' ? 'orWhere' : 'where'

    switch (operator) {
      case 'eq':
        query = query[method](`${model}.${field}`, '=', value)
        break
      case 'ne':
        query = query[method](`${model}.${field}`, '<>', value)
        break
      case 'gt':
        query = query[method](`${model}.${field}`, '>', value)
        break
      case 'gte':
        query = query[method](`${model}.${field}`, '>=', value)
        break
      case 'lt':
        query = query[method](`${model}.${field}`, '<', value)
        break
      case 'lte':
        query = query[method](`${model}.${field}`, '<=', value)
        break
      case 'in':
        query = query[method === 'orWhere' ? 'orWhereIn' : 'whereIn'](
          `${model}.${field}`,
          Array.isArray(value) ? value : [value]
        )
        break
      case 'not_in':
        query = query[method === 'orWhere' ? 'orWhereNotIn' : 'whereNotIn'](
          `${model}.${field}`,
          Array.isArray(value) ? value : [value]
        )
        break
      case 'contains': {
        const escaped = escapeLikeValue(value)
        const rawMethod = connector === 'OR' ? 'orWhereRaw' : 'whereRaw'
        query = query[rawMethod]("?? like ? escape '\\'", [
          `${model}.${field}`,
          `%${escaped}%`
        ])
        break
      }
      case 'starts_with': {
        const escaped = escapeLikeValue(value)
        const rawMethod = connector === 'OR' ? 'orWhereRaw' : 'whereRaw'
        query = query[rawMethod]("?? like ? escape '\\'", [
          `${model}.${field}`,
          `${escaped}%`
        ])
        break
      }
      case 'ends_with': {
        const escaped = escapeLikeValue(value)
        const rawMethod = connector === 'OR' ? 'orWhereRaw' : 'whereRaw'
        query = query[rawMethod]("?? like ? escape '\\'", [
          `${model}.${field}`,
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

export const knexAdapter = (db: Knex) =>
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
          const record = data as Record<string, unknown>
          const id = record.id as string

          if (tableName === 'sessions') {
            let row: unknown
            await db.transaction(async (trx) => {
              await trx(tableName).insert(record)
              await recordWeeklyLogin(
                trx,
                getSessionAccountId(record),
                getSessionCreatedAt(record)
              )
              row = await trx(tableName).where(`${tableName}.id`, id).first()
            })
            if (!row) throw new Error('Failed to create record')
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
          await db(tableName)
            .where(`${tableName}.id`, id)
            .update(updateData as Record<string, unknown>)
          const row = await db(tableName).where(`${tableName}.id`, id).first()
          return row ? (hydrateDateFields(row) as any) : null
        },

        async updateMany({ model, where, update: updateData }) {
          const tableName = getModelName(model)
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          const result = await query.update(
            updateData as Record<string, unknown>
          )
          return result
        },

        async delete({ model, where }) {
          const tableName = getModelName(model)
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          await query.delete()
        },

        async deleteMany({ model, where }) {
          const tableName = getModelName(model)
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
