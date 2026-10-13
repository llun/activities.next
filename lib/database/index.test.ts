import { sql } from 'kysely'

import { getDatabase, getKysely } from '@/lib/database'

const { createDatabaseConnection } = vi.hoisted(() => ({
  createDatabaseConnection: vi.fn()
}))

vi.mock('@/lib/database/connection', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/database/connection')>()
  createDatabaseConnection.mockImplementation(actual.createDatabaseConnection)
  return { ...actual, createDatabaseConnection }
})

// The test setup configures an in-memory better-sqlite3 database.
describe('the application database', () => {
  afterAll(async () => {
    await getDatabase()?.destroy()
  })

  it('opens one connection, with sqlcommenter on, from the configuration', async () => {
    const db = getKysely()
    expect(getKysely()).toBe(db)
    getDatabase()

    expect(createDatabaseConnection).toHaveBeenCalledTimes(1)
    expect(createDatabaseConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' }
      }),
      { sqlcommenter: true }
    )

    const result = await sql<{ value: number }>`select 1 as value`.execute(db)
    expect(result.rows).toEqual([{ value: 1 }])
  })

  it('serves the facade from the same Kysely instance', async () => {
    const database = getDatabase()
    await sql`create table server_settings (key text primary key, value text, "createdAt" datetime, "updatedAt" datetime)`.execute(
      getKysely()
    )
    await database?.setServerSettings([{ key: 'probe', value: 'yes' }])
    const { rows } = await sql<{
      key: string
    }>`select key from server_settings`.execute(getKysely())
    expect(rows).toEqual([{ key: 'probe' }])
  })
})
