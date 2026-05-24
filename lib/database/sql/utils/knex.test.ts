import {
  KnexConnection,
  SQLITE_MAX_BINDINGS,
  getInsertBatchSize,
  getWhereInBatchSize
} from './knex'

const databaseWithClient = (client: string) =>
  ({
    client: {
      config: {
        client
      }
    }
  }) as KnexConnection

describe('knex SQL utilities', () => {
  it('caps non-SQLite whereIn batches by default', () => {
    expect(getWhereInBatchSize(databaseWithClient('pg'))).toBe(1000)
    expect(getWhereInBatchSize(databaseWithClient('pg'), 0, 250)).toBe(250)
  })

  it('keeps SQLite whereIn batches under the bind limit', () => {
    expect(getWhereInBatchSize(databaseWithClient('better-sqlite3'), 7)).toBe(
      SQLITE_MAX_BINDINGS - 7
    )
  })

  it('keeps SQLite inserts under the bind limit', () => {
    expect(
      getInsertBatchSize(databaseWithClient('better-sqlite3'), {
        first: 'value',
        second: 'value'
      })
    ).toBe(Math.floor(SQLITE_MAX_BINDINGS / 2))
  })

  it('caps non-SQLite insert batches by default', () => {
    expect(getInsertBatchSize(databaseWithClient('pg'), { id: 'value' })).toBe(
      1000
    )
    expect(
      getInsertBatchSize(databaseWithClient('pg'), { id: 'value' }, 250)
    ).toBe(250)
  })

  it('keeps SQLite inserts within the configured batch cap', () => {
    expect(
      getInsertBatchSize(
        databaseWithClient('better-sqlite3'),
        { id: 'value' },
        250
      )
    ).toBe(250)
  })
})
