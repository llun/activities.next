import { isUniqueConstraintError } from './isUniqueConstraintError'

describe('isUniqueConstraintError', () => {
  it('matches PostgreSQL unique constraint errors', () => {
    expect(isUniqueConstraintError({ code: '23505' })).toBe(true)
  })

  it('matches MySQL unique constraint errors', () => {
    expect(isUniqueConstraintError({ code: 'ER_DUP_ENTRY' })).toBe(true)
    expect(isUniqueConstraintError({ errno: 1062 })).toBe(true)
  })

  it('matches SQLite unique constraint errors', () => {
    expect(isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(
      true
    )
    expect(
      isUniqueConstraintError({
        code: 'SQLITE_CONSTRAINT',
        message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: table.column'
      })
    ).toBe(true)
  })

  it('ignores non-unique errors and non-error values', () => {
    expect(isUniqueConstraintError({ code: 'SQLITE_BUSY' })).toBe(false)
    expect(isUniqueConstraintError({ message: 'foreign key mismatch' })).toBe(
      false
    )
    expect(isUniqueConstraintError(null)).toBe(false)
    expect(isUniqueConstraintError('UNIQUE constraint failed')).toBe(false)
  })
})
