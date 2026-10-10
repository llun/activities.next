import {
  createPostgresTypeParsers,
  parseInt8
} from '@/lib/database/kysely/normalize'

describe('PostgreSQL int8 parsing', () => {
  it('reads safe integers as numbers', () => {
    expect(parseInt8('0')).toBe(0)
    expect(parseInt8('-42')).toBe(-42)
    expect(parseInt8(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER
    )
  })

  it('throws a RangeError naming a value above the safe integer range', () => {
    expect(() => parseInt8('9007199254740993')).toThrow(RangeError)
    expect(() => parseInt8('9007199254740993')).toThrow('9007199254740993')
    expect(() => parseInt8('-9007199254740993')).toThrow(RangeError)
  })

  it('is the parser used for int8 but not for numeric', () => {
    const parsers = createPostgresTypeParsers({
      getTypeParser: () => (value: string) => value
    })
    expect(() => parsers.getTypeParser(20)('9007199254740993')).toThrow(
      RangeError
    )
    expect(parsers.getTypeParser(1700)('1.5')).toBe(1.5)
  })
})
