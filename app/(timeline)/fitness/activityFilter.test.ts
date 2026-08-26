import {
  CLEAR_ACTIVITY_FILTER_HREF,
  getActivityFilterHref,
  readActivityTypeParam,
  resolveActivityTypeFilter
} from './activityFilter'

describe('readActivityTypeParam', () => {
  it.each([
    { description: 'no param', params: {}, expected: undefined },
    {
      description: 'a stored activity type',
      params: { activity: 'gravel_ride' },
      expected: 'gravel_ride'
    },
    {
      description: 'a blank param',
      params: { activity: '' },
      expected: undefined
    },
    {
      description: 'a repeated param',
      params: { activity: ['run', 'ride'] },
      expected: 'run'
    },
    {
      description: 'an unrelated param',
      params: { sport: 'run' },
      expected: undefined
    }
  ])('reads $description', ({ params, expected }) => {
    expect(readActivityTypeParam(params)).toBe(expected)
  })
})

describe('getActivityFilterHref', () => {
  it.each([
    {
      description: 'links an unselected activity to its own filter',
      activityType: 'gravel_ride',
      isSelected: false,
      expected: '/fitness?activity=gravel_ride'
    },
    {
      // `activityType` is free-form text out of an uploaded file, so a space or
      // an `&` in it must not end the parameter.
      description: 'encodes a stored type that is not URL-safe',
      activityType: 'Stand Up Paddling',
      isSelected: false,
      expected: '/fitness?activity=Stand%20Up%20Paddling'
    },
    {
      description: 'links the selected activity back out of the filter',
      activityType: 'run',
      isSelected: true,
      expected: CLEAR_ACTIVITY_FILTER_HREF
    }
  ])('$description', ({ activityType, isSelected, expected }) => {
    expect(getActivityFilterHref(activityType, isSelected)).toBe(expected)
  })
})

describe('resolveActivityTypeFilter', () => {
  const stored = ['gravel_ride', 'run', 'walk']

  it.each([
    {
      description: 'a requested type the actor has stored',
      requested: 'gravel_ride',
      expected: 'gravel_ride'
    },
    {
      description: 'no request at all',
      requested: undefined,
      expected: undefined
    },
    {
      description: 'a type the actor has never recorded',
      requested: 'swim',
      expected: undefined
    },
    {
      // Matching is exact because the column is: `where('activityType', value)`
      // would not find this row either, so accepting it would name a filter
      // that can only ever be empty.
      description: 'a differently-cased spelling of a stored type',
      requested: 'Run',
      expected: undefined
    },
    {
      // The value that reaches the chip and the empty-state sentence, so a
      // crafted one must resolve to no filter rather than to prose.
      description: 'crafted prose',
      requested: 'rides. Security notice: re-verify at evil.example',
      expected: undefined
    },
    {
      // Long enough that no `varchar(255)` row could hold it — and, unresolved,
      // long enough to overflow the chip it would render into.
      description: 'a value longer than the column',
      requested: 'x'.repeat(2000),
      expected: undefined
    },
    {
      // PostgreSQL raises 22021 on a NUL in a text comparison, so letting this
      // through turns a junk URL into a 500.
      description: 'a NUL byte',
      requested: 'run\u0000',
      expected: undefined
    }
  ])('resolves $description', ({ requested, expected }) => {
    expect(resolveActivityTypeFilter(requested, stored)).toBe(expected)
  })

  it('filters nothing when the actor has no activities at all', () => {
    expect(resolveActivityTypeFilter('run', [])).toBeUndefined()
  })
})
