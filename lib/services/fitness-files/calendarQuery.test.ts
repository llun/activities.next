import {
  DEFAULT_DAY_ACTIVITIES_LIMIT,
  FitnessCalendarDayQuery,
  FitnessCalendarQuery,
  FitnessCalendarRangeQuery,
  MAX_DAY_ACTIVITIES_LIMIT,
  TimeZoneParam,
  describeCalendarQueryError
} from './calendarQuery'

const HOUR_MS = 60 * 60 * 1000

describe('TimeZoneParam', () => {
  it.each([
    ['Europe/Amsterdam', 'Europe/Amsterdam'],
    ['europe/amsterdam', 'Europe/Amsterdam'],
    ['utc', 'UTC'],
    ['america/los_angeles', 'America/Los_Angeles'],
    ['Etc/GMT+12', 'Etc/GMT+12']
  ])('accepts %s as %s', (input, canonical) => {
    const parsed = TimeZoneParam.safeParse(input)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toBe(canonical)
  })

  it('accepts a three-segment zone', () => {
    // Its canonical spelling depends on the ICU version, so only acceptance is
    // asserted here.
    expect(
      TimeZoneParam.safeParse('America/Argentina/Buenos_Aires').success
    ).toBe(true)
  })

  it.each([
    ['an offset zone', '+05:30'],
    ['a negative offset zone', '-08:00'],
    ['an unknown zone', 'Not/AZone'],
    ['an empty string', ''],
    ['a 65-character name', `A${'a'.repeat(64)}`],
    ['a path traversal', '../etc/passwd'],
    ['a non-string', 42]
  ])('rejects %s', (_label, input) => {
    expect(TimeZoneParam.safeParse(input).success).toBe(false)
  })
})

describe('FitnessCalendarRangeQuery', () => {
  it('turns local dates into a half-open instant window in the zone', () => {
    const parsed = FitnessCalendarRangeQuery.safeParse({
      from: '2026-01-01',
      to: '2026-10-04',
      time_zone: 'Europe/Amsterdam'
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({
      from: '2026-01-01',
      to: '2026-10-04',
      timeZone: 'Europe/Amsterdam',
      // 1 Jan 00:00 CET (UTC+1) and 5 Oct 00:00 CEST (UTC+2).
      startMs: Date.UTC(2025, 11, 31, 23),
      endMs: Date.UTC(2026, 9, 4, 22)
    })
  })

  it('accepts a single-day range, so This month loads on its first day', () => {
    const parsed = FitnessCalendarRangeQuery.safeParse({
      from: '2026-10-01',
      to: '2026-10-01',
      time_zone: 'UTC'
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.endMs).toBe((parsed.data?.startMs ?? 0) + 24 * HOUR_MS)
  })

  it('builds the window from the canonical zone', () => {
    const parsed = FitnessCalendarRangeQuery.safeParse({
      from: '2026-07-01',
      to: '2026-07-01',
      time_zone: 'america/los_angeles'
    })
    expect(parsed.data?.timeZone).toBe('America/Los_Angeles')
    expect(parsed.data?.startMs).toBe(Date.UTC(2026, 6, 1, 7))
  })

  it.each([
    ['missing from', { to: '2026-10-04', time_zone: 'UTC' }],
    ['missing to', { from: '2026-10-04', time_zone: 'UTC' }],
    ['missing time_zone', { from: '2026-10-01', to: '2026-10-04' }],
    [
      'an impossible date',
      { from: '2026-02-30', to: '2026-03-01', time_zone: 'UTC' }
    ],
    [
      'a non-padded date',
      { from: '2026-1-01', to: '2026-03-01', time_zone: 'UTC' }
    ],
    [
      'an instant instead of a date',
      { from: '1767225600000', to: '2026-03-01', time_zone: 'UTC' }
    ],
    [
      'a date before 1970',
      { from: '1969-12-31', to: '2026-03-01', time_zone: 'UTC' }
    ],
    [
      'an inverted range',
      { from: '2026-10-05', to: '2026-10-04', time_zone: 'UTC' }
    ],
    [
      'an offset zone',
      { from: '2026-10-01', to: '2026-10-04', time_zone: '+05:30' }
    ],
    [
      'the last representable day, which has no next day to end on',
      { from: '9999-12-30', to: '9999-12-31', time_zone: 'UTC' }
    ]
  ])('rejects %s', (_label, query) => {
    expect(FitnessCalendarRangeQuery.safeParse(query).success).toBe(false)
  })

  it('names the parameter in the error message', () => {
    const parsed = FitnessCalendarRangeQuery.safeParse({
      from: '2026-10-05',
      to: '2026-10-04',
      time_zone: 'UTC'
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(describeCalendarQueryError(parsed.error)).toBe(
      'Invalid to: Must not be before from'
    )
  })
})

describe('FitnessCalendarQuery', () => {
  it('passes a stored activity type through and drops an empty one', () => {
    const base = { from: '2026-10-01', to: '2026-10-04', time_zone: 'UTC' }
    expect(
      FitnessCalendarQuery.safeParse({ ...base, activity_type: 'running' }).data
        ?.activityType
    ).toBe('running')
    expect(
      FitnessCalendarQuery.safeParse({ ...base, activity_type: '' }).data
        ?.activityType
    ).toBeUndefined()
  })

  it('rejects an oversized activity type', () => {
    expect(
      FitnessCalendarQuery.safeParse({
        from: '2026-10-01',
        to: '2026-10-04',
        time_zone: 'UTC',
        activity_type: 'x'.repeat(256)
      }).success
    ).toBe(false)
  })
})

describe('FitnessCalendarQuery activity_type', () => {
  it.each([
    ['a bare NUL byte', '\u0000'],
    ['a NUL byte inside a type', 'run\u0000ning']
  ])('rejects %s with a message that names the parameter', (_label, value) => {
    const parsed = FitnessCalendarQuery.safeParse({
      from: '2026-10-01',
      to: '2026-10-04',
      time_zone: 'UTC',
      activity_type: value
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(describeCalendarQueryError(parsed.error)).toBe(
      'Invalid activity_type: Must not contain a NUL byte'
    )
  })

  it('accepts other control characters, which a stored type may hold', () => {
    expect(
      FitnessCalendarQuery.safeParse({
        from: '2026-10-01',
        to: '2026-10-04',
        time_zone: 'UTC',
        activity_type: 'run\tning'
      }).data?.activityType
    ).toBe('run\tning')
  })
})

describe('FitnessCalendarDayQuery', () => {
  it('covers exactly one local day, 23 hours on the spring-forward day', () => {
    const parsed = FitnessCalendarDayQuery.safeParse({
      date: '2026-03-29',
      time_zone: 'Europe/Amsterdam'
    })
    expect(parsed.data).toEqual({
      date: '2026-03-29',
      timeZone: 'Europe/Amsterdam',
      startMs: Date.UTC(2026, 2, 28, 23),
      endMs: Date.UTC(2026, 2, 29, 22),
      limit: DEFAULT_DAY_ACTIVITIES_LIMIT,
      offset: 0
    })
  })

  it('covers 25 hours on the fall-back day', () => {
    const parsed = FitnessCalendarDayQuery.safeParse({
      date: '2026-10-25',
      time_zone: 'Europe/Amsterdam'
    })
    const { startMs = 0, endMs = 0 } = parsed.data ?? {}
    expect(endMs - startMs).toBe(25 * HOUR_MS)
  })

  it.each([
    ['5', 5, '10', 10],
    ['0', 1, '-3', 0],
    ['500', MAX_DAY_ACTIVITIES_LIMIT, '7', 7],
    ['abc', DEFAULT_DAY_ACTIVITIES_LIMIT, '1.5', 0],
    [undefined, DEFAULT_DAY_ACTIVITIES_LIMIT, undefined, 0]
  ])(
    'clamps limit=%s to %s and offset=%s to %s',
    (limit, expectedLimit, offset, expectedOffset) => {
      const parsed = FitnessCalendarDayQuery.safeParse({
        date: '2026-10-04',
        time_zone: 'UTC',
        limit,
        offset
      })
      expect(parsed.data?.limit).toBe(expectedLimit)
      expect(parsed.data?.offset).toBe(expectedOffset)
    }
  )

  it.each([
    ['a missing date', { time_zone: 'UTC' }],
    ['an impossible date', { date: '2026-02-29', time_zone: 'UTC' }],
    ['a missing zone', { date: '2026-10-04' }],
    ['an unknown zone', { date: '2026-10-04', time_zone: 'Mars/Olympus' }]
  ])('rejects %s', (_label, query) => {
    expect(FitnessCalendarDayQuery.safeParse(query).success).toBe(false)
  })
})

describe('FitnessCalendarRangeQuery first day', () => {
  it('accepts 1970-01-01, the first day the range picker offers', () => {
    expect(
      FitnessCalendarRangeQuery.safeParse({
        from: '1970-01-01',
        to: '1970-01-31',
        time_zone: 'UTC'
      }).success
    ).toBe(true)
  })
})
