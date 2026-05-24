import { Knex } from 'knex'

export type KnexConnection = Knex | Knex.Transaction

export const SQLITE_MAX_BINDINGS = 999

const SQLITE_CLIENTS = new Set(['sqlite3', 'better-sqlite3'])
const POSTGRES_CLIENTS = new Set(['pg', 'postgres', 'postgresql'])
const MYSQL_CLIENTS = new Set(['mysql', 'mysql2'])

export const getClientName = (database: KnexConnection) =>
  String(database.client.config.client).toLowerCase()

export const isSQLiteClient = (database: KnexConnection) =>
  SQLITE_CLIENTS.has(getClientName(database))

export const isPostgresClient = (database: KnexConnection) =>
  POSTGRES_CLIENTS.has(getClientName(database))

export const isMySQLClient = (database: KnexConnection) =>
  MYSQL_CLIENTS.has(getClientName(database))

export const getWhereInBatchSize = (
  database: KnexConnection,
  reservedBindings = 0,
  defaultBatchSize = 1000
) => {
  if (!isSQLiteClient(database)) return defaultBatchSize
  return Math.max(1, SQLITE_MAX_BINDINGS - reservedBindings)
}

export const getInsertBatchSize = (
  database: KnexConnection,
  row: Record<string, unknown>,
  defaultBatchSize = Number.POSITIVE_INFINITY
) => {
  if (!isSQLiteClient(database)) return defaultBatchSize

  const columnCount = Math.max(1, Object.keys(row).length)
  return Math.max(1, Math.floor(SQLITE_MAX_BINDINGS / columnCount))
}

export const chunkArray = <T>(items: T[], size: number) => {
  const chunkSize = Number.isFinite(size)
    ? Math.max(1, Math.floor(size))
    : Math.max(items.length, 1)
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize))
  }
  return chunks
}

export const deleteRowsByColumnChunks = async (
  database: KnexConnection,
  tableName: string,
  columnName: string,
  values: string[]
) => {
  for (const valueChunk of chunkArray(values, getWhereInBatchSize(database))) {
    await database(tableName).whereIn(columnName, valueChunk).delete()
  }
}

export const isKnexTransaction = (
  database: KnexConnection
): database is Knex.Transaction =>
  Boolean((database as { isTransaction?: boolean }).isTransaction)
