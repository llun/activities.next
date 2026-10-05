import {
  ActivityTypeParam,
  TrimmedOptionalActivityTypeParam
} from './activityTypeParam'

describe('ActivityTypeParam', () => {
  it.each([
    ['a bare NUL byte', '\u0000'],
    ['a NUL byte inside a type', 'run\u0000ning']
  ])('rejects %s', (_label, value) => {
    const parsed = ActivityTypeParam.safeParse(value)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe('Must not contain a NUL byte')
  })

  it('accepts other control characters, which a stored type may hold', () => {
    expect(ActivityTypeParam.safeParse('run\tning\u0001').data).toBe(
      'run\tning\u0001'
    )
  })
})

describe('TrimmedOptionalActivityTypeParam', () => {
  it('trims the value', () => {
    expect(TrimmedOptionalActivityTypeParam.parse('  running ')).toBe('running')
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   ']
  ])('reads a %s value as all activities', (_label, value) => {
    const parsed = TrimmedOptionalActivityTypeParam.safeParse(value)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toBeUndefined()
  })

  it.each([
    ['a bare NUL byte', '\u0000'],
    // Trimming strips whitespace, not NUL, so padding cannot smuggle one in.
    ['a padded NUL byte', ' \u0000 '],
    ['a NUL byte inside a type', 'run\u0000ning']
  ])('rejects %s', (_label, value) => {
    const parsed = TrimmedOptionalActivityTypeParam.safeParse(value)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe('Must not contain a NUL byte')
  })

  it('rejects a value that is not a string', () => {
    expect(TrimmedOptionalActivityTypeParam.safeParse(42).success).toBe(false)
  })
})
