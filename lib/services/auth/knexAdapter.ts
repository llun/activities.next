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
    adapter: ({
      getModelName,
      getFieldName,
      getDefaultModelName,
      transformInput,
      transformOutput,
      transformWhereClause
    }) => {
      return {
        async create({ data, model, select }) {
          const tableName = getModelName(model)
          const defaultModel = getDefaultModelName(model)
          const transformed = await transformInput(
            data as Record<string, unknown>,
            defaultModel,
            'create',
            true
          )

          await db(tableName).insert(transformed)

          const idField = getFieldName({ model, field: 'id' })
          const row = await db(tableName)
            .where(`${tableName}.${idField}`, transformed[idField] as string)
            .first()
          if (!row) throw new Error('Failed to create record')
          return (await transformOutput(row, defaultModel, select)) as any
        },

        async findOne({ model, where, select }) {
          const tableName = getModelName(model)
          const defaultModel = getDefaultModelName(model)
          const transformedWhere = transformWhereClause({
            model,
            where,
            action: 'findOne'
          })

          let query = db(tableName).first()
          if (transformedWhere) {
            query = applyWhere(query, tableName, transformedWhere)
          }

          const row = await query
          if (!row) return null
          return (await transformOutput(row, defaultModel, select)) as any
        },

        async findMany({ model, where, limit, sortBy, offset, select }) {
          const tableName = getModelName(model)
          const defaultModel = getDefaultModelName(model)
          const transformedWhere = where
            ? transformWhereClause({ model, where, action: 'findMany' })
            : undefined

          let query = db(tableName)
          if (transformedWhere) {
            query = applyWhere(query, tableName, transformedWhere)
          }
          if (sortBy) {
            const sortField = getFieldName({ model, field: sortBy.field })
            query = query.orderBy(`${tableName}.${sortField}`, sortBy.direction)
          }
          if (limit) query = query.limit(limit)
          if (offset) query = query.offset(offset)

          const rows = await query
          const results = []
          for (const row of rows) {
            results.push(await transformOutput(row, defaultModel, select))
          }
          return results as any
        },

        async count({ model, where }) {
          const tableName = getModelName(model)
          const transformedWhere = where
            ? transformWhereClause({ model, where, action: 'count' })
            : undefined

          let query = db(tableName).count('* as count')
          if (transformedWhere) {
            query = applyWhere(query, tableName, transformedWhere)
          }

          const result = await query.first()
          return Number(result?.count ?? 0)
        },

        async update({ model, where, update: updateData }) {
          const tableName = getModelName(model)
          const defaultModel = getDefaultModelName(model)
          const transformedWhere = transformWhereClause({
            model,
            where,
            action: 'update'
          })
          const transformed = await transformInput(
            updateData as Record<string, unknown>,
            defaultModel,
            'update'
          )

          let query = db(tableName)
          if (transformedWhere) {
            query = applyWhere(query, tableName, transformedWhere)
          }
          await query.update(transformed)

          let selectQuery = db(tableName).first()
          if (transformedWhere) {
            selectQuery = applyWhere(selectQuery, tableName, transformedWhere)
          }
          const row = await selectQuery
          if (!row) return null
          return (await transformOutput(row, defaultModel)) as any
        },

        async updateMany({ model, where, update: updateData }) {
          const tableName = getModelName(model)
          const defaultModel = getDefaultModelName(model)
          const transformedWhere = transformWhereClause({
            model,
            where,
            action: 'updateMany'
          })
          const transformed = await transformInput(
            updateData as Record<string, unknown>,
            defaultModel,
            'update'
          )

          let query = db(tableName)
          if (transformedWhere) {
            query = applyWhere(query, tableName, transformedWhere)
          }
          const result = await query.update(transformed)
          return result
        },

        async delete({ model, where }) {
          const tableName = getModelName(model)
          const transformedWhere = transformWhereClause({
            model,
            where,
            action: 'delete'
          })

          let query = db(tableName)
          if (transformedWhere) {
            query = applyWhere(query, tableName, transformedWhere)
          }
          await query.delete()
        },

        async deleteMany({ model, where }) {
          const tableName = getModelName(model)
          const transformedWhere = transformWhereClause({
            model,
            where,
            action: 'deleteMany'
          })

          let query = db(tableName)
          if (transformedWhere) {
            query = applyWhere(query, tableName, transformedWhere)
          }
          const result = await query.delete()
          return result
        }
      }
    }
  })
