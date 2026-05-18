import { BooleanSearchParam } from './searchParams'

describe('BooleanSearchParam', () => {
  it.each(['true', '1', 't', 'yes', 'y', 'on'])(
    'parses %s as true',
    (value) => {
      expect(BooleanSearchParam.parse(value)).toBe(true)
    }
  )

  it.each(['false', '0', 'f', 'no', 'n', 'off'])(
    'parses %s as false',
    (value) => {
      expect(BooleanSearchParam.parse(value)).toBe(false)
    }
  )

  it('rejects invalid boolean values', () => {
    expect(() => BooleanSearchParam.parse('maybe')).toThrow()
  })
})
