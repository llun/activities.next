import { normalizeActivityTypeToSportKey } from '@/lib/services/fitness-files/sportTypes'

import {
  formatActivityTypeLabel,
  getActivityPresentation
} from './activityPresentation'

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
    {
      description: 'Handcycle',
      type: 'Handcycle',
      label: 'Handcycling',
      emoji: '🚴'
    },
    {
      description: 'Velomobile',
      type: 'Velomobile',
      label: 'Velomobile',
      emoji: '🚴'
    },
    {
      description: 'VirtualRun',
      type: 'VirtualRun',
      label: 'Indoor running',
      emoji: '🏃'
    },
    {
      description: 'VirtualRow',
      type: 'VirtualRow',
      label: 'Indoor rowing',
      emoji: '🚣'
    }
  ])(
    'keeps $description more specific than its sport key',
    ({ type, label, emoji }) => {
      expect(getActivityPresentation(type)).toEqual({ label, emoji })
    }
  )

  it('still attributes the specific sports to the right gear kind', () => {
    // The caption is more specific, but the SPORT KEY must not move — a
    // handcycle is still attributed to a bike.
    expect(normalizeActivityTypeToSportKey('Handcycle')).toBe('ride')
    expect(normalizeActivityTypeToSportKey('Velomobile')).toBe('ride')
    expect(normalizeActivityTypeToSportKey('VirtualRun')).toBe('run')
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

  it.each([
    { description: 'rowing', type: 'rowing', label: 'Rowing', emoji: '🚣' },
    { description: 'Rowing', type: 'Rowing', label: 'Rowing', emoji: '🚣' },
    {
      description: 'Kayaking',
      type: 'Kayaking',
      label: 'Kayaking',
      emoji: '🚣'
    },
    { description: 'yoga', type: 'yoga', label: 'Yoga', emoji: '🧘' },
    { description: 'Yoga', type: 'Yoga', label: 'Yoga', emoji: '🧘' },
    { description: 'Pilates', type: 'Pilates', label: 'Pilates', emoji: '🧘' },
    {
      description: 'Meditation',
      type: 'Meditation',
      label: 'Meditation',
      emoji: '🧘'
    },
    {
      description: 'climbing',
      type: 'climbing',
      label: 'Climbing',
      emoji: '🧗'
    },
    {
      description: 'RockClimbing',
      type: 'RockClimbing',
      label: 'Rock climbing',
      emoji: '🧗'
    },
    { description: 'ski', type: 'ski', label: 'Skiing', emoji: '⛷️' },
    {
      description: 'AlpineSki',
      type: 'AlpineSki',
      label: 'Alpine skiing',
      emoji: '⛷️'
    },
    {
      description: 'Snowboard',
      type: 'Snowboard',
      label: 'Snowboarding',
      emoji: '🏂'
    },
    { description: 'skating', type: 'skating', label: 'Skating', emoji: '⛸️' },
    {
      description: 'IceSkate',
      type: 'IceSkate',
      label: 'Ice skating',
      emoji: '⛸️'
    },
    {
      description: 'Skateboard',
      type: 'Skateboard',
      label: 'Skateboarding',
      emoji: '🛹'
    },
    { description: 'surfing', type: 'surfing', label: 'Surfing', emoji: '🏄' },
    {
      description: 'ScubaDiving',
      type: 'ScubaDiving',
      label: 'Scuba diving',
      emoji: '🤿'
    },
    { description: 'tennis', type: 'tennis', label: 'Tennis', emoji: '🎾' },
    {
      description: 'racket_sports',
      type: 'racket_sports',
      label: 'Racket sports',
      emoji: '🎾'
    },
    { description: 'boxing', type: 'boxing', label: 'Boxing', emoji: '🥊' },
    {
      description: 'martial_arts',
      type: 'martial_arts',
      label: 'Martial arts',
      emoji: '🥊'
    },
    { description: 'karate', type: 'karate', label: 'Karate', emoji: '🥋' },
    { description: 'soccer', type: 'soccer', label: 'Soccer', emoji: '⚽' },
    {
      description: 'football',
      type: 'football',
      label: 'Football',
      emoji: '🏈'
    },
    {
      description: 'team_sports',
      type: 'team_sports',
      label: 'Team sports',
      emoji: '⚽'
    },
    { description: 'golf', type: 'golf', label: 'Golf', emoji: '⛳' },
    {
      description: 'training',
      type: 'training',
      label: 'Training',
      emoji: '🏋️'
    },
    {
      description: 'WeightTraining',
      type: 'WeightTraining',
      label: 'Weight training',
      emoji: '🏋️'
    },
    {
      description: 'Workout',
      type: 'Workout',
      label: 'Workout',
      emoji: '🏋️'
    },
    { description: 'other', type: 'other', label: 'Other', emoji: '🏋️' },
    { description: 'Other', type: 'Other', label: 'Other', emoji: '🏋️' }
  ])('names $description appropriately', ({ type, label, emoji }) => {
    expect(getActivityPresentation(type)).toEqual({ label, emoji })
  })

  it('capitalizes an unrecognised type rather than guessing a sport', () => {
    expect(getActivityPresentation('skydiving')).toEqual({
      label: 'Skydiving',
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

describe('formatActivityTypeLabel', () => {
  it.each([
    { description: 'a single word', type: 'ride', expected: 'Ride' },
    {
      description: 'an underscored key',
      type: 'gravel_ride',
      expected: 'Gravel Ride'
    },
    {
      description: 'a type already capitalised',
      type: 'Ride',
      expected: 'Ride'
    },
    {
      description: 'an unmapped sport stored verbatim',
      type: 'stand_up_paddling',
      expected: 'Stand Up Paddling'
    }
  ])('names $description', ({ type, expected }) => {
    expect(formatActivityTypeLabel(type)).toBe(expected)
  })

  it('keeps stored spellings the post caption folds together apart', () => {
    // `ride` and `cycling` both caption "Cycling" — right for a post, wrong for
    // a list whose two rows carry separate numbers and separate filters.
    expect(getActivityPresentation('ride').label).toBe('Cycling')
    expect(getActivityPresentation('cycling').label).toBe('Cycling')

    expect(formatActivityTypeLabel('ride')).toBe('Ride')
    expect(formatActivityTypeLabel('cycling')).toBe('Cycling')
  })
})
