import {
  CLEAR_ACTIVITY_FILTER_HREF,
  getActivityFilterHref,
  readActivityTypeParam
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
  it('links an unselected activity to its own filter', () => {
    expect(getActivityFilterHref('gravel_ride', false)).toBe(
      '/fitness?activity=gravel_ride'
    )
  })

  it('encodes a stored type that is not URL-safe', () => {
    // `activityType` is free-form text out of an uploaded file, so a space or a
    // `&` in it must not end the parameter.
    expect(getActivityFilterHref('Stand Up Paddling', false)).toBe(
      '/fitness?activity=Stand%20Up%20Paddling'
    )
  })

  it('links the selected activity back out of the filter', () => {
    expect(getActivityFilterHref('run', true)).toBe(CLEAR_ACTIVITY_FILTER_HREF)
  })
})
