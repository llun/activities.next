import type { Knex } from 'knex'
import {
  CompiledQuery,
  type ConnectionProvider,
  type DatabaseConnection,
  type Dialect,
  type DialectAdapter,
  type Driver,
  IdentifierNode,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryCompiler,
  type QueryResult,
  RawNode,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type TransactionSettings,
  createQueryId
} from 'kysely'

import {
  type DatabaseKey,
  MixedDatabaseTransactionError,
  assertRootKyselyMayAcquire,
  getDatabaseKey,
  isConnectionHeldByCurrentContext,
  runWithKyselyConnection
} from '@/lib/database/kysely/guard'
import {
  type PostgresTypes,
  createPostgresTypeParsers,
  normalizeSqliteRows,
  toSqliteBinding
} from '@/lib/database/kysely/normalize'
import {
  getTraceparentCommentSuffix,
  isSqlcommenterAttached
} from '@/lib/database/sqlcommenter'

// A Kysely driver that owns no connections. Every connection is borrowed from
// a Knex client (`client.acquireConnection()`) and handed back
// (`client.releaseConnection()`) when Kysely is done with it, so the two
// libraries take turns on SQLite's single connection and share one PostgreSQL
// pool. Borrowing from a Knex TRANSACTION's client returns that transaction's
// connection (and releasing it is a no-op), which is how `kyselyFor(trx)`
// joins a Knex transaction. A Kysely transaction holds its borrowed
// connection from BEGIN to COMMIT/ROLLBACK.
//
// Statements run directly on the borrowed driver connection so results can be
// normalised with the column type information (see normalize.ts): timestamps
// come back as epoch milliseconds, int8/numeric as numbers, booleans as
// booleans and JSON parsed, on both backends.
//
// Each statement is also announced on the Knex client the way a Knex query is
// (`query`, then `query-response` or `query-error`; the Knex instance re-emits
// them, and a transaction's client forwards them to the root), so tests that
// capture SQL with `instance.on('query', …)` see Kysely statements too. It
// carries the sqlcommenter `traceparent` suffix when the Knex instance has
// `attachSqlcommenter` applied.

export type KyselyDialectName = 'sqlite' | 'postgres'

type RawConnection = object & { __knexUid?: string; __knexTxId?: string }

type BetterSqliteStatement = {
  reader: boolean
  columns(): { name: string; type: string | null }[]
  all(params: unknown[]): Record<string, unknown>[]
  run(params: unknown[]): {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }
}

type BetterSqliteDatabase = RawConnection & {
  prepare(sql: string): BetterSqliteStatement
}

type PostgresResult = {
  command?: string
  rowCount?: number | null
  rows?: Record<string, unknown>[]
}

type PostgresClient = RawConnection & {
  query(config: {
    text: string
    values: unknown[]
    types: PostgresTypes
  }): Promise<PostgresResult | PostgresResult[]>
}

type KnexQueryEvent = {
  sql: string
  bindings: unknown[]
  method: 'raw'
  options: Record<string, never>
  __knexUid?: string
  __knexTxId?: string
  __knexQueryUid: string
  kysely: true
}

let queryCounter = 0

// Only better-sqlite3 and pg are supported. node-sqlite3, pg-native and MySQL
// lack the per-statement column types, per-query type parsers and upsert
// syntax the Kysely layer relies on. lib/database/index.ts checks this when the
// database is first created, so an unsupported client fails at startup.
export const getKyselyDialectName = (
  client: Knex.Client
): KyselyDialectName => {
  if (client.dialect === 'sqlite3' && client.driverName === 'better-sqlite3') {
    return 'sqlite'
  }
  if (client.dialect === 'postgresql' && client.driverName === 'pg') {
    return 'postgres'
  }
  throw new Error(
    `Unsupported database client: the Knex "${client.dialect}" dialect with ` +
      `the "${client.driverName}" driver. Only better-sqlite3 (SQLite) and ` +
      'pg (PostgreSQL) are supported; set ACTIVITIES_DATABASE_CLIENT ' +
      'accordingly (see docs/setup.md).'
  )
}

const toBigInt = (value: number | bigint | null | undefined) =>
  value === null || value === undefined ? undefined : BigInt(value)

class KnexBorrowedConnection implements DatabaseConnection {
  readonly raw: RawConnection
  released = false
  readonly #driver: KnexPoolDriver

  constructor(driver: KnexPoolDriver, raw: RawConnection) {
    this.#driver = driver
    this.raw = raw
  }

  executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    return this.#driver.execute<R>(this.raw, compiledQuery)
  }

  // The drivers return whole result sets here, so this buffers the rows and
  // yields them one at a time rather than streaming from the database.
  async *streamQuery<R>(
    compiledQuery: CompiledQuery
  ): AsyncIterableIterator<QueryResult<R>> {
    // On the root instance the rows would be consumed outside the async
    // context that holds this connection, so a root Knex or Kysely query in
    // the loop body would wait on the pool this stream is holding.
    if (
      !this.#driver.isTransactionBound &&
      !isConnectionHeldByCurrentContext(this)
    ) {
      throw new MixedDatabaseTransactionError(
        'stream() is not supported on the root Knex-backed Kysely instance; ' +
          'use execute(), or stream inside db.transaction().execute() or ' +
          'db.connection().execute().'
      )
    }
    const result = await this.executeQuery<R>(compiledQuery)
    for (const row of result.rows) {
      yield { rows: [row] }
    }
  }
}

const isBorrowedConnection = (
  connection: DatabaseConnection
): connection is KnexBorrowedConnection =>
  connection instanceof KnexBorrowedConnection

export class KnexPoolDriver implements Driver {
  readonly #source: Knex
  readonly #client: Knex.Client
  readonly #dialect: KyselyDialectName
  readonly #postgresTypes: PostgresTypes | null

  constructor(source: Knex, dialect: KyselyDialectName) {
    this.#source = source
    this.#client = source.client
    this.#dialect = dialect
    this.#postgresTypes =
      dialect === 'postgres'
        ? createPostgresTypeParsers(
            (this.#client.driver as { types: PostgresTypes }).types
          )
        : null
  }

  get isTransactionBound() {
    return Boolean((this.#source as { isTransaction?: boolean }).isTransaction)
  }

  async init() {
    // Nothing to set up: the pool belongs to Knex.
  }

  async acquireConnection(): Promise<KnexBorrowedConnection> {
    const raw = (await this.#client.acquireConnection()) as RawConnection
    return new KnexBorrowedConnection(this, raw)
  }

  async releaseConnection(connection: DatabaseConnection) {
    if (!isBorrowedConnection(connection) || connection.released) return
    connection.released = true
    await this.#client.releaseConnection(connection.raw)
  }

  async execute<R>(
    raw: RawConnection,
    compiledQuery: CompiledQuery
  ): Promise<QueryResult<R>> {
    const transaction = this.#source as Knex & { isCompleted?: () => boolean }
    if (this.isTransactionBound && transaction.isCompleted?.()) {
      // Knex refuses statements on a finished transaction; so does this.
      throw new Error(
        'Transaction query already complete: kyselyFor(trx) was used after ' +
          'the Knex transaction committed or rolled back'
      )
    }

    const suffix = isSqlcommenterAttached(this.#client)
      ? getTraceparentCommentSuffix()
      : null
    const sql = suffix ? `${compiledQuery.sql}${suffix}` : compiledQuery.sql
    const bindings = [...compiledQuery.parameters]
    queryCounter += 1
    const event: KnexQueryEvent = {
      sql,
      bindings,
      method: 'raw',
      options: {},
      __knexUid: raw.__knexUid,
      __knexTxId: raw.__knexTxId,
      __knexQueryUid: `kysely${queryCounter}`,
      kysely: true
    }

    this.#client.emit('query', event)
    let result: QueryResult<R>
    try {
      result =
        this.#dialect === 'sqlite'
          ? this.#executeSqlite<R>(raw as BetterSqliteDatabase, sql, bindings)
          : await this.#executePostgres<R>(raw as PostgresClient, sql, bindings)
    } catch (error) {
      this.#client.emit('query-error', error, event)
      throw error
    }
    this.#client.emit('query-response', result, event)
    return result
  }

  #executeSqlite<R>(
    database: BetterSqliteDatabase,
    sql: string,
    bindings: unknown[]
  ): QueryResult<R> {
    const statement = database.prepare(sql)
    const parameters = bindings.map(toSqliteBinding)
    if (statement.reader) {
      const rows = statement.all(parameters)
      return { rows: normalizeSqliteRows(rows, statement.columns()) as R[] }
    }
    const { changes, lastInsertRowid } = statement.run(parameters)
    return {
      rows: [],
      numAffectedRows: toBigInt(changes),
      insertId: toBigInt(lastInsertRowid)
    }
  }

  async #executePostgres<R>(
    client: PostgresClient,
    sql: string,
    bindings: unknown[]
  ): Promise<QueryResult<R>> {
    const response = await client.query({
      text: sql,
      values: bindings,
      types: this.#postgresTypes as PostgresTypes
    })
    // A multi-statement string yields one result per statement; report the
    // last, as psql does.
    const result = Array.isArray(response)
      ? response[response.length - 1]
      : response
    const command = result?.command
    const affected =
      command === 'INSERT' ||
      command === 'UPDATE' ||
      command === 'DELETE' ||
      command === 'MERGE'
    return {
      rows: (result?.rows ?? []) as R[],
      numAffectedRows: affected ? toBigInt(result?.rowCount) : undefined
    }
  }

  async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings
  ) {
    if (this.isTransactionBound) {
      throw new MixedDatabaseTransactionError(
        'kyselyFor(trx) is already inside the Knex transaction trx; run the ' +
          'queries on it directly instead of opening another transaction ' +
          '(inTransaction() does this for code that may get either).'
      )
    }
    if (
      !isBorrowedConnection(connection) ||
      !isConnectionHeldByCurrentContext(connection)
    ) {
      // `db.startTransaction()` (a controlled transaction) hands the
      // connection out of the async context that borrowed it, so the
      // mixed-transaction guard could not see a root Knex query issued while
      // it is open. Only the callback form keeps it inside one context.
      // Kysely never releases a controlled connection whose BEGIN failed, so
      // hand it back here or SQLite's only connection would be gone for good.
      await this.releaseConnection(connection)
      throw new MixedDatabaseTransactionError(
        'Kysely controlled transactions (db.startTransaction()) are not ' +
          'supported on the Knex-backed Kysely instance; use ' +
          'db.transaction().execute(async (trx) => …) instead.'
      )
    }

    if (this.#dialect === 'sqlite') {
      // SQLite has neither isolation levels nor access modes; Kysely's own
      // SQLite driver ignores the settings the same way.
      await connection.executeQuery(CompiledQuery.raw('begin'))
      return
    }
    let sql = 'begin'
    if (settings.isolationLevel || settings.accessMode) {
      sql = 'start transaction'
      if (settings.isolationLevel) {
        sql += ` isolation level ${settings.isolationLevel}`
      }
      if (settings.accessMode) sql += ` ${settings.accessMode}`
    }
    await connection.executeQuery(CompiledQuery.raw(sql))
  }

  async commitTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw('commit'))
  }

  async rollbackTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw('rollback'))
  }

  async savepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler['compileQuery']
  ) {
    await connection.executeQuery(
      compileQuery(
        savepointCommand('savepoint', savepointName),
        createQueryId()
      )
    )
  }

  async rollbackToSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler['compileQuery']
  ) {
    await connection.executeQuery(
      compileQuery(
        savepointCommand('rollback to', savepointName),
        createQueryId()
      )
    )
  }

  async releaseSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler['compileQuery']
  ) {
    await connection.executeQuery(
      compileQuery(savepointCommand('release', savepointName), createQueryId())
    )
  }

  // Knex owns the pool and the SQLite handle, and kyselyFor() shares one
  // instance per Knex instance, so destroying it is a no-op: the usual
  // `await db.destroy()` end-of-script idiom must not break other callers.
  async destroy() {
    // Nothing to release.
  }
}

const savepointCommand = (command: string, savepointName: string) =>
  RawNode.createWithChildren([
    RawNode.createWithSql(`${command} `),
    IdentifierNode.create(savepointName)
  ])

// Wraps the driver so every connection the ROOT instance borrows is recorded
// for the async context that uses it (see guard.ts), and so the root instance
// fails before it waits on the pool when the context is inside a Knex
// transaction. A transaction-bound instance borrows the transaction's own
// connection and needs neither check.
export class KnexConnectionProvider implements ConnectionProvider {
  readonly #driver: KnexPoolDriver
  readonly #key: DatabaseKey

  constructor(driver: KnexPoolDriver, client: Knex.Client) {
    this.#driver = driver
    this.#key = getDatabaseKey(client)
  }

  async provideConnection<T>(
    consumer: (connection: DatabaseConnection) => Promise<T>
  ): Promise<T> {
    const root = !this.#driver.isTransactionBound
    if (root) assertRootKyselyMayAcquire(this.#key)
    const connection = await this.#driver.acquireConnection()
    try {
      return root
        ? await runWithKyselyConnection(this.#key, connection, () =>
            consumer(connection)
          )
        : await consumer(connection)
    } finally {
      await this.#driver.releaseConnection(connection)
    }
  }
}

export const createKnexDialect = (source: Knex): Dialect => {
  const name = getKyselyDialectName(source.client)
  return {
    createDriver: () => new KnexPoolDriver(source, name),
    createQueryCompiler: (): QueryCompiler =>
      name === 'sqlite'
        ? new SqliteQueryCompiler()
        : new PostgresQueryCompiler(),
    createAdapter: (): DialectAdapter =>
      name === 'sqlite' ? new SqliteAdapter() : new PostgresAdapter(),
    createIntrospector: (db) =>
      name === 'sqlite'
        ? new SqliteIntrospector(db)
        : new PostgresIntrospector(db)
  }
}
