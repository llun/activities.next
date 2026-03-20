import { CleanedWhere, createAdapterFactory } from 'better-auth/adapters'
import { Knex } from 'knex'

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
      case 'contains':
        query = query[method](`${model}.${field}`, 'like', `%${value}%`)
        break
      case 'starts_with':
        query = query[method](`${model}.${field}`, 'like', `${value}%`)
        break
      case 'ends_with':
        query = query[method](`${model}.${field}`, 'like', `%${value}`)
        break
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
      return {
        async create({ data, model }) {
          const tableName = getModelName(model)
          const idField = getFieldName({ model, field: 'id' })
          await db(tableName).insert(data)
          const row = await db(tableName)
            .where(
              `${tableName}.${idField}`,
              (data as Record<string, unknown>)[idField] as string
            )
            .first()
          if (!row) throw new Error('Failed to create record')
          return row as any
        },

        async findOne({ model, where }) {
          const tableName = getModelName(model)
          let query = db(tableName).first()
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          const row = await query
          return (row ?? null) as any
        },

        async findMany({ model, where, limit, sortBy, offset }) {
          const tableName = getModelName(model)
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          if (sortBy) {
            const sortField = getFieldName({ model, field: sortBy.field })
            query = query.orderBy(`${tableName}.${sortField}`, sortBy.direction)
          }
          if (limit) query = query.limit(limit)
          if (offset) query = query.offset(offset)
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
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, where)
          }
          await query.update(updateData as Record<string, unknown>)
          let selectQuery = db(tableName).first()
          if (where) {
            selectQuery = applyWhere(selectQuery, tableName, where)
          }
          const row = await selectQuery
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
