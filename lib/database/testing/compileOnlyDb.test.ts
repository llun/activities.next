import { getDialectName } from '@/lib/database/kysely/dialect'
import { createCompileOnlyDb } from '@/lib/database/testing/compileOnlyDb'

describe('createCompileOnlyDb', () => {
  it.each([
    ['pg' as const, 'postgres', 'select "id" from "statuses" where "id" = $1'],
    ['sqlite' as const, 'sqlite', 'select "id" from "statuses" where "id" = ?']
  ])(
    'compiles for %s without a connection',
    async (backend, dialect, expected) => {
      const db = createCompileOnlyDb(backend)

      expect(getDialectName(db)).toBe(dialect)
      const { sql, parameters } = db
        .selectFrom('statuses')
        .select('id')
        .where('id', '=', 'status-1')
        .compile()
      expect(sql).toBe(expected)
      expect(parameters).toEqual(['status-1'])
      await db.destroy()
    }
  )

  it('runs nothing: a query it is asked to execute returns no rows', async () => {
    const db = createCompileOnlyDb('sqlite')

    expect(await db.selectFrom('statuses').select('id').execute()).toEqual([])
  })
})
