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
        query = query[method](`${model}.${field}`, 'like', `%${escaped}%`)
        break
      }
      case 'starts_with': {
        const escaped = escapeLikeValue(value)
        query = query[method](`${model}.${field}`, 'like', `${escaped}%`)
        break
      }
      case 'ends_with': {
        const escaped = escapeLikeValue(value)
        query = query[method](`${model}.${field}`, 'like', `%${escaped}`)
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
      const transformData = (
        model: string,
        data: Record<string, unknown>
      ): Record<string, unknown> => {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(data)) {
          const fieldName = getFieldName({ model, field: key })
          result[fieldName] = value
        }
        return result
      }

      const transformWhere = (
        model: string,
        where: CleanedWhere[]
      ): CleanedWhere[] => {
        return where.map((clause) => ({
          ...clause,
          field: getFieldName({ model, field: clause.field })
        }))
      }

      return {
        async create({ data, model }) {
          const tableName = getModelName(model)
          const idField = getFieldName({ model, field: 'id' })
          const transformed = transformData(
            model,
            data as Record<string, unknown>
          )
          await db(tableName).insert(transformed)
          const row = await db(tableName)
            .where(`${tableName}.${idField}`, transformed[idField] as string)
            .first()
          if (!row) throw new Error('Failed to create record')
          return row as any
        },

        async findOne({ model, where }) {
          const tableName = getModelName(model)
          let query = db(tableName).first()
          if (where) {
            query = applyWhere(query, tableName, transformWhere(model, where))
          }
          const row = await query
          return (row ?? null) as any
        },

        async findMany({ model, where, limit, sortBy, offset }) {
          const tableName = getModelName(model)
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, transformWhere(model, where))
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
            query = applyWhere(query, tableName, transformWhere(model, where))
          }
          const result = await query.first()
          return Number(result?.count ?? 0)
        },

        async update({ model, where, update: updateData }) {
          const tableName = getModelName(model)
          const idField = getFieldName({ model, field: 'id' })
          let idQuery = db(tableName).first(idField)
          if (where) {
            idQuery = applyWhere(
              idQuery,
              tableName,
              transformWhere(model, where)
            )
          }
          const existing = await idQuery
          if (!existing) return null as any
          const id = existing[idField]
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, transformWhere(model, where))
          }
          const transformedUpdate = transformData(
            model,
            updateData as Record<string, unknown>
          )
          await query.update(transformedUpdate)
          const row = await db(tableName)
            .where(`${tableName}.${idField}`, id)
            .first()
          return (row ?? null) as any
        },

        async updateMany({ model, where, update: updateData }) {
          const tableName = getModelName(model)
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, transformWhere(model, where))
          }
          const transformedUpdate = transformData(
            model,
            updateData as Record<string, unknown>
          )
          const result = await query.update(transformedUpdate)
          return result
        },

        async delete({ model, where }) {
          const tableName = getModelName(model)
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, transformWhere(model, where))
          }
          await query.delete()
        },

        async deleteMany({ model, where }) {
          const tableName = getModelName(model)
          let query = db(tableName)
          if (where) {
            query = applyWhere(query, tableName, transformWhere(model, where))
          }
          const result = await query.delete()
          return result
        }
      }
    }
  })
