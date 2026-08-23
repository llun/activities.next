import {
  CANONICAL_STORED_ACTIVITY_TYPES,
  FITNESS_GEAR_KINDS,
  SPORT_KEYS,
  SPORT_KIND,
  USER_CREATABLE_GEAR_KINDS,
  getGearKindForActivityType,
  getSportKeysForKind,
  getSportLabel,
  isCanonicalStoredActivityType,
  isSportKey,
  normalizeActivityTypeToSportKey,
  normalizeStoredActivityType
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
    { description: 'an unrecognised sport', raw: 'Kayaking' },
    // The lookup table is an object literal, so a bare index would find
    // `Object.prototype`'s members. `activityType` is free-form GPX text, so
    // these are reachable input, and `constructor` used to come back as the
    // `Object` constructor function typed as a SportKey.
    { description: 'the inherited constructor property', raw: 'constructor' },
    { description: 'the inherited toString property', raw: 'toString' },
    { description: 'a __proto__ probe', raw: '__proto__' }
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

  it('returns null for an inherited Object property name', () => {
    expect(getGearKindForActivityType('constructor')).toBeNull()
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

describe('gear kinds', () => {
  it('models a recording device beside bikes and shoes', () => {
    expect(FITNESS_GEAR_KINDS).toEqual(['bike', 'shoes', 'device'])
  })

  it('lets a person create only a bike or shoes', () => {
    // Devices are system-created: `resolveDeviceGear` is the sole writer, keyed
    // on the identity the recorded file carried.
    expect(USER_CREATABLE_GEAR_KINDS).toEqual(['bike', 'shoes'])
  })

  it('gives a device no sports of its own', () => {
    // A device records rides and runs alike, so claiming a sport would take it
    // off the bike or shoes that should hold it. This falls out of SPORT_KIND
    // rather than being special-cased.
    expect(getSportKeysForKind('device')).toEqual([])
    expect(Object.values(SPORT_KIND)).not.toContain('device')
  })

  it('never derives a device from an activity type', () => {
    for (const raw of ['Ride', 'running', 'Biking', 'kayaking']) {
      expect(getGearKindForActivityType(raw)).not.toBe('device')
    }
  })
})

describe('isCanonicalStoredActivityType', () => {
  it('accepts all sport keys and non-gear stored types', () => {
    for (const key of CANONICAL_STORED_ACTIVITY_TYPES) {
      expect(isCanonicalStoredActivityType(key)).toBe(true)
    }
  })

  it('rejects raw activity types or unmapped types', () => {
    expect(isCanonicalStoredActivityType('WeightTraining')).toBe(false)
    expect(isCanonicalStoredActivityType('Other')).toBe(false)
    expect(isCanonicalStoredActivityType('Rowing')).toBe(false)
    expect(isCanonicalStoredActivityType('swimming')).toBe(false)
  })
})

describe('normalizeStoredActivityType', () => {
  it.each([
    { description: 'FIT cycling', raw: 'cycling', stored: 'ride' },
    {
      description: 'FIT gravel_cycling',
      raw: 'gravel_cycling',
      stored: 'gravel_ride'
    },
    {
      description: 'FIT indoor_cycling',
      raw: 'indoor_cycling',
      stored: 'virtual_ride'
    },
    { description: 'TCX Biking', raw: 'Biking', stored: 'ride' },
    { description: 'Strava Ride', raw: 'Ride', stored: 'ride' },
    {
      description: 'Strava GravelRide',
      raw: 'GravelRide',
      stored: 'gravel_ride'
    },
    { description: 'GPX free text', raw: 'Road cycling', stored: 'ride' },

    // Training / Gym / Workout
    {
      description: 'Strava WeightTraining',
      raw: 'WeightTraining',
      stored: 'training'
    },
    {
      description: 'spaced Weight Training',
      raw: 'Weight Training',
      stored: 'training'
    },
    {
      description: 'FIT weight_training',
      raw: 'weight_training',
      stored: 'training'
    },
    { description: 'Strava Crossfit', raw: 'Crossfit', stored: 'training' },
    { description: 'Strava Workout', raw: 'Workout', stored: 'training' },
    { description: 'Strava HIIT', raw: 'HIIT', stored: 'training' },
    { description: 'FIT training', raw: 'training', stored: 'training' },
    {
      description: 'FIT fitness_equipment',
      raw: 'fitness_equipment',
      stored: 'training'
    },
    {
      description: 'FIT calisthenics',
      raw: 'calisthenics',
      stored: 'training'
    },
    { description: 'FIT yoga', raw: 'yoga', stored: 'training' },
    { description: 'FIT pilates', raw: 'pilates', stored: 'training' },

    // Rowing
    { description: 'Strava Rowing', raw: 'Rowing', stored: 'rowing' },
    { description: 'Strava VirtualRow', raw: 'VirtualRow', stored: 'rowing' },
    { description: 'FIT rowing', raw: 'rowing', stored: 'rowing' },
    {
      description: 'FIT indoor_rowing',
      raw: 'indoor_rowing',
      stored: 'rowing'
    },
    { description: 'free-form Row', raw: 'Row', stored: 'rowing' },

    // Other (normalized to lowercase)
    { description: 'TCX Other', raw: 'Other', stored: 'other' },
    { description: 'Strava Other', raw: 'Other', stored: 'other' },
    { description: 'FIT generic', raw: 'generic', stored: 'other' },
    { description: 'lowercase other', raw: 'other', stored: 'other' },
    { description: 'spaced Other', raw: '  Other  ', stored: 'other' }
  ])('collapses $description to its stored key', ({ raw, stored }) => {
    expect(normalizeStoredActivityType(raw)).toBe(stored)
  })

  it('collapses every vocabulary for one sport onto one stored value', () => {
    // The reason the column is normalized at all: the fitness overview
    // breakdown groups on the raw string, so three spellings of one ride were
    // three rows in the table.
    const storedRides = ['cycling', 'Biking', 'Ride', 'road_cycling'].map(
      normalizeStoredActivityType
    )
    expect(new Set(storedRides)).toEqual(new Set(['ride']))

    const storedTraining = [
      'WeightTraining',
      'Weight Training',
      'weight_training',
      'Workout',
      'training'
    ].map(normalizeStoredActivityType)
    expect(new Set(storedTraining)).toEqual(new Set(['training']))

    const storedRowing = [
      'Rowing',
      'VirtualRow',
      'indoor_rowing',
      'rowing'
    ].map(normalizeStoredActivityType)
    expect(new Set(storedRowing)).toEqual(new Set(['rowing']))

    const storedOther = ['Other', 'other', 'generic', '  Other  '].map(
      normalizeStoredActivityType
    )
    expect(new Set(storedOther)).toEqual(new Set(['other']))
  })

  it('is idempotent, so a backfill is safe to rerun', () => {
    for (const key of CANONICAL_STORED_ACTIVITY_TYPES) {
      expect(normalizeStoredActivityType(key)).toBe(key)
    }
  })

  it.each([
    { description: 'a swim', raw: 'swimming' },
    { description: 'free-form text', raw: 'Kayaking' },
    { description: 'spaced free-form text', raw: '  Kayaking  ' }
  ])('defaults unmatched $description to other', ({ raw }) => {
    expect(normalizeActivityTypeToSportKey(raw)).toBeNull()
    expect(normalizeStoredActivityType(raw)).toBe('other')
  })

  it.each([
    { description: 'undefined', raw: undefined },
    { description: 'null', raw: null },
    { description: 'an empty string', raw: '' },
    { description: 'whitespace only', raw: '   ' }
  ])('answers null for $description', ({ raw }) => {
    expect(normalizeStoredActivityType(raw)).toBeNull()
  })
})
