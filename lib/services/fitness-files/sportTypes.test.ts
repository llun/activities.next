import {
  SPORT_KEYS,
  SPORT_KIND,
  getGearKindForActivityType,
  getSportKeysForKind,
  getSportLabel,
  isSportKey,
  normalizeActivityTypeToSportKey
} from '@/lib/services/fitness-files/sportTypes'

describe('normalizeActivityTypeToSportKey', () => {
  it.each([
    // Strava sport_type — written verbatim into imported TCX/GPX
    { description: 'Strava Ride', raw: 'Ride', expected: 'ride' },
    {
      description: 'Strava GravelRide',
      raw: 'GravelRide',
      expected: 'gravel_ride'
    },
    {
      description: 'Strava MountainBikeRide',
      raw: 'MountainBikeRide',
      expected: 'mountain_bike_ride'
    },
    {
      description: 'Strava EBikeRide',
      raw: 'EBikeRide',
      expected: 'ebike_ride'
    },
    {
      description: 'Strava EMountainBikeRide',
      raw: 'EMountainBikeRide',
      expected: 'ebike_ride'
    },
    {
      description: 'Strava VirtualRide',
      raw: 'VirtualRide',
      expected: 'virtual_ride'
    },
    { description: 'Strava Run', raw: 'Run', expected: 'run' },
    { description: 'Strava TrailRun', raw: 'TrailRun', expected: 'trail_run' },
    { description: 'Strava VirtualRun', raw: 'VirtualRun', expected: 'run' },
    { description: 'Strava Walk', raw: 'Walk', expected: 'walk' },
    { description: 'Strava Hike', raw: 'Hike', expected: 'hike' },

    // FIT sport / sub_sport
    { description: 'FIT cycling', raw: 'cycling', expected: 'ride' },
    {
      description: 'FIT gravel_cycling',
      raw: 'gravel_cycling',
      expected: 'gravel_ride'
    },
    {
      description: 'FIT mountain sub_sport',
      raw: 'mountain',
      expected: 'mountain_bike_ride'
    },
    {
      description: 'FIT indoor_cycling',
      raw: 'indoor_cycling',
      expected: 'virtual_ride'
    },
    {
      description: 'FIT e_bike_fitness',
      raw: 'e_bike_fitness',
      expected: 'ebike_ride'
    },
    { description: 'FIT running', raw: 'running', expected: 'run' },
    { description: 'FIT trail sub_sport', raw: 'trail', expected: 'trail_run' },
    { description: 'FIT treadmill', raw: 'treadmill', expected: 'run' },
    { description: 'FIT walking', raw: 'walking', expected: 'walk' },
    { description: 'FIT hiking', raw: 'hiking', expected: 'hike' },

    // TCX Sport attribute
    { description: 'TCX Biking', raw: 'Biking', expected: 'ride' },
    { description: 'TCX Running', raw: 'Running', expected: 'run' },

    // Free-form GPX track types and separator variants
    {
      description: 'spaced Gravel ride',
      raw: 'Gravel ride',
      expected: 'gravel_ride'
    },
    {
      description: 'hyphenated e-bike ride',
      raw: 'e-bike ride',
      expected: 'ebike_ride'
    },
    {
      description: 'uppercase MTB',
      raw: 'MTB',
      expected: 'mountain_bike_ride'
    },
    {
      description: 'cyclocross falls back to ride',
      raw: 'cyclocross',
      expected: 'ride'
    },
    {
      description: 'trail running compound',
      raw: 'Trail Running',
      expected: 'trail_run'
    }
  ])('maps $description to $expected', ({ raw, expected }) => {
    expect(normalizeActivityTypeToSportKey(raw)).toBe(expected)
  })

  it.each([
    { description: 'undefined', raw: undefined },
    { description: 'null', raw: null },
    { description: 'an empty string', raw: '' },
    { description: 'punctuation only', raw: '   ---  ' },
    { description: 'swimming, which has no gear kind', raw: 'swimming' },
    { description: 'a gym workout', raw: 'WeightTraining' },
    { description: "Garmin's ambiguous Other", raw: 'Other' },
    { description: 'an unrecognised sport', raw: 'Kayaking' }
  ])('returns null for $description', ({ raw }) => {
    expect(normalizeActivityTypeToSportKey(raw)).toBeNull()
  })

  it('does not read mountaineering as mountain biking', () => {
    expect(normalizeActivityTypeToSportKey('Mountaineering')).toBeNull()
  })
})

describe('getGearKindForActivityType', () => {
  it.each([
    { description: 'a ride', raw: 'GravelRide', expected: 'bike' },
    { description: 'a virtual ride', raw: 'VirtualRide', expected: 'bike' },
    { description: 'a run', raw: 'running', expected: 'shoes' },
    { description: 'a hike', raw: 'Hike', expected: 'shoes' }
  ])('returns $expected for $description', ({ raw, expected }) => {
    expect(getGearKindForActivityType(raw)).toBe(expected)
  })

  it('returns null when the activity type is unrecognised', () => {
    expect(getGearKindForActivityType('Kayaking')).toBeNull()
  })
})

describe('getSportKeysForKind', () => {
  it('returns only bike sports for bikes', () => {
    expect(getSportKeysForKind('bike')).toEqual([
      'ride',
      'gravel_ride',
      'mountain_bike_ride',
      'ebike_ride',
      'virtual_ride'
    ])
  })

  it('returns only shoe sports for shoes', () => {
    expect(getSportKeysForKind('shoes')).toEqual([
      'run',
      'trail_run',
      'walk',
      'hike'
    ])
  })

  it('covers every sport key across both kinds', () => {
    expect([
      ...getSportKeysForKind('bike'),
      ...getSportKeysForKind('shoes')
    ]).toHaveLength(SPORT_KEYS.length)
  })
})

describe('isSportKey', () => {
  it('accepts a canonical key', () => {
    expect(isSportKey('trail_run')).toBe(true)
  })

  it('rejects a raw activity type', () => {
    expect(isSportKey('TrailRun')).toBe(false)
  })
})

describe('getSportLabel', () => {
  it('returns the display label for a canonical key', () => {
    expect(getSportLabel('mountain_bike_ride')).toBe('Mountain bike ride')
  })

  it('falls back to the given value for an unknown key', () => {
    expect(getSportLabel('kayaking')).toBe('kayaking')
  })

  it('labels every sport key', () => {
    for (const key of SPORT_KEYS) {
      expect(getSportLabel(key)).not.toBe(key)
      expect(SPORT_KIND[key]).toMatch(/^(bike|shoes)$/)
    }
  })
})
