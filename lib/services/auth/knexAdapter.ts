import { CleanedWhere, createAdapterFactory } from 'better-auth/adapters'
import { Knex } from 'knex'

const escapeLikeValue = (value: unknown): string => {
  return String(value).replace(/[%_\\]/g, '\\$&')
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
        query = query[method](`${model}.${field}`, '=', value)
    }
  }
  return query
}

export const knexAdapter = (db: Knex) =>
  createAdapterFactory({
    config: {
      adapterId: 'knex',
      supportsNumericIds: false
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
          await db(tableName).insert(record)
          const id = record.id as string
          const row = await db(tableName).where(`${tableName}.id`, id).first()
          if (!row) throw new Error('Failed to create record')
          return row as any
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
          return (row ?? null) as any
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
          return rows as any
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
          if (!existing) return null as any
          const id = existing.id
          await db(tableName)
            .where(`${tableName}.id`, id)
            .update(updateData as Record<string, unknown>)
          const row = await db(tableName).where(`${tableName}.id`, id).first()
          return (row ?? null) as any
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
