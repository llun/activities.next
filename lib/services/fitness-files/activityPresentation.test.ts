import { getActivityPresentation } from './activityPresentation'

describe('getActivityPresentation', () => {
  it.each([
    // The canonical form new imports store, and what the backfill writes.
    { description: 'ride', type: 'ride', label: 'Cycling', emoji: '🚴' },
    {
      description: 'gravel_ride',
      type: 'gravel_ride',
      label: 'Gravel cycling',
      emoji: '🚴'
    },
    {
      description: 'mountain_bike_ride',
      type: 'mountain_bike_ride',
      label: 'Mountain biking',
      emoji: '🚵'
    },
    {
      description: 'ebike_ride',
      type: 'ebike_ride',
      label: 'E-bike cycling',
      emoji: '🚴'
    },
    {
      description: 'virtual_ride',
      type: 'virtual_ride',
      label: 'Indoor cycling',
      emoji: '🚴'
    },
    { description: 'run', type: 'run', label: 'Running', emoji: '🏃' },
    {
      description: 'trail_run',
      type: 'trail_run',
      label: 'Trail running',
      emoji: '🏃'
    },
    { description: 'walk', type: 'walk', label: 'Walking', emoji: '🚶' },
    { description: 'hike', type: 'hike', label: 'Hiking', emoji: '🥾' }
  ])('names a $description', ({ type, label, emoji }) => {
    expect(getActivityPresentation(type)).toEqual({ label, emoji })
  })

  it.each([
    // The pre-sport-key table already produced these words for the vocabularies
    // it covered. Post text is federated and stored forever, so normalizing the
    // column must not silently reword what was already being published.
    { description: 'FIT cycling', type: 'cycling', label: 'Cycling' },
    { description: 'FIT running', type: 'running', label: 'Running' },
    { description: 'FIT walking', type: 'walking', label: 'Walking' },
    { description: 'FIT hiking', type: 'hiking', label: 'Hiking' },
    { description: 'TCX Biking', type: 'Biking', label: 'Cycling' }
  ])('keeps the wording $description already published', ({ type, label }) => {
    expect(getActivityPresentation(type).label).toBe(label)
  })

  it('names a pre-normalization value the same as its normalized form', () => {
    // A file stored before the write-side rule, or reprocessed since, still
    // carries the raw string. Both spellings must caption identically or the
    // backfill would appear to change the activity.
    for (const [raw, normalized] of [
      ['cycling', 'ride'],
      ['Biking', 'ride'],
      ['gravel_cycling', 'gravel_ride'],
      ['running', 'run'],
      ['hiking', 'hike']
    ]) {
      expect(getActivityPresentation(raw)).toEqual(
        getActivityPresentation(normalized)
      )
    }
  })

  it('gives a Strava spelling a bike glyph, not the generic one', () => {
    // The bug this replaced: no Strava spelling was in the raw-string table, so
    // a Strava ride was captioned "Ride 🏋️" while the very same ride out of a
    // FIT file was captioned "Cycling 🚴".
    expect(getActivityPresentation('Ride')).toEqual({
      label: 'Cycling',
      emoji: '🚴'
    })
    expect(getActivityPresentation('GravelRide')).toEqual({
      label: 'Gravel cycling',
      emoji: '🚴'
    })
  })

  it.each([
    { description: 'swimming', type: 'swimming' },
    { description: 'swim', type: 'swim' },
    { description: 'lap_swimming', type: 'lap_swimming' },
    { description: 'Open Water Swimming', type: 'Open Water Swimming' }
  ])('names $description as a swim, which no sport key models', ({ type }) => {
    expect(getActivityPresentation(type)).toEqual({
      label: 'Swimming',
      emoji: '🏊'
    })
  })

  it('capitalizes an unrecognised type rather than guessing a sport', () => {
    expect(getActivityPresentation('kayaking')).toEqual({
      label: 'Kayaking',
      emoji: '🏋️'
    })
  })

  it.each([
    { description: 'undefined', type: undefined },
    { description: 'null', type: null },
    { description: 'an empty string', type: '' },
    { description: 'whitespace only', type: '   ' }
  ])('falls back to a generic workout for $description', ({ type }) => {
    expect(getActivityPresentation(type)).toEqual({
      label: 'Workout',
      emoji: '🏋️'
    })
  })

  it('does not read an inherited Object.prototype member as a sport', () => {
    // `activityType` is free-form text out of an uploaded file. A bare index
    // would destructure the `Object` constructor and write
    // "undefined undefined" into the post body.
    expect(getActivityPresentation('constructor')).toEqual({
      label: 'Constructor',
      emoji: '🏋️'
    })
  })
})
