import { SetRegionNameBody } from './types'

describe('SetRegionNameBody', () => {
  const region = 'rect:52.60,5.60,52.00,6.20'

  it('trims the name', () => {
    expect(
      SetRegionNameBody.parse({ region, name: '  Veluwe loop  ' }).name
    ).toBe('Veluwe loop')
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', '   ']
  ])('reads a %s name as clearing the label', (_label, name) => {
    expect(SetRegionNameBody.parse({ region, name }).name).toBeNull()
  })

  // PostgreSQL rejects a NUL byte in a bound text parameter (22021).
  it.each([
    ['a bare NUL byte', '\u0000'],
    // Trimming strips whitespace, not NUL, so padding cannot smuggle one in.
    ['a padded NUL byte', ' \u0000 '],
    ['a NUL byte inside it', 'Veluwe\u0000loop']
  ])('rejects a name with %s', (_label, name) => {
    const parsed = SetRegionNameBody.safeParse({ region, name })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe('Must not contain a NUL byte')
  })

  it('accepts other control characters in the name', () => {
    expect(SetRegionNameBody.parse({ region, name: 'Veluwe\tloop' }).name).toBe(
      'Veluwe\tloop'
    )
  })

  it('rejects a name over the 255-char column', () => {
    expect(
      SetRegionNameBody.safeParse({ region, name: 'a'.repeat(256) }).success
    ).toBe(false)
  })
})
