/**
 * Canonical sport keys for gear assignment.
 *
 * `fitness_files.activityType` is whatever string the source file carried, and
 * four vocabularies reach it: FIT sport/sub_sport names (`cycling`,
 * `gravel_cycling`), Garmin TCX `Sport` attributes (`Biking`, `Running`),
 * Strava `sport_type` values (`GravelRide`, `VirtualRide` — written verbatim
 * into the TCX/GPX this app generates for Strava imports), and free-form GPX
 * `<trk><type>` text. Gear default-sports therefore cannot key on the raw
 * string; they store a canonical key and match through
 * `normalizeActivityTypeToSportKey`.
 *
 * This module is deliberately dependency-free and carries no `'use client'`
 * directive: the auto-assign job, the API routes and the gear UI all import it,
 * and a server module reading a value out of a client module gets nothing (see
 * AGENTS.md → Server/Client Module Boundary).
 *
 * Only sports that a bike or a pair of shoes is used for are modelled. Swimming
 * and gym work normalize to null — there is no gear kind to attribute them to.
 */

export const SPORT_KEYS = [
  'ride',
  'gravel_ride',
  'mountain_bike_ride',
  'ebike_ride',
  'virtual_ride',
  'run',
  'trail_run',
  'walk',
  'hike'
] as const

export type SportKey = (typeof SPORT_KEYS)[number]

/**
 * `device` is the recording head unit or watch an activity was captured on. It
 * is gear in the sense that it has a page of its own and every activity points
 * at one, but it shares almost nothing else with a bike or a pair of shoes: it
 * has no components, no default sports, no distance total, no service reminder
 * and cannot be retired.
 */
export const FITNESS_GEAR_KINDS = ['bike', 'shoes', 'device'] as const

export type FitnessGearKind = (typeof FITNESS_GEAR_KINDS)[number]

/**
 * The kinds a person may create. Devices are system-created only —
 * `resolveDeviceGear` is the sole writer, keyed on the immutable identity the
 * recorded file carried — so `POST /api/v1/fitness/gear` rejects `device` the
 * same way it rejects a kind that does not exist. A hand-made device row would
 * have no `deviceKey` to match an upload against and would sit there forever
 * with nothing attributed to it.
 */
export const USER_CREATABLE_GEAR_KINDS = ['bike', 'shoes'] as const

export type UserCreatableGearKind = (typeof USER_CREATABLE_GEAR_KINDS)[number]

export const SPORT_LABELS: Record<SportKey, string> = {
  ride: 'Ride',
  gravel_ride: 'Gravel ride',
  mountain_bike_ride: 'Mountain bike ride',
  ebike_ride: 'E-bike ride',
  virtual_ride: 'Virtual ride',
  run: 'Run',
  trail_run: 'Trail run',
  walk: 'Walk',
  hike: 'Hike'
}

/**
 * Typed against the user-creatable kinds, not `FitnessGearKind`: a device
 * records rides and runs alike, so no sport belongs to one and nothing may
 * derive a device from a sport. `getSportKeysForKind('device')` therefore
 * answers `[]` on its own, with no special case.
 */
export const SPORT_KIND: Record<SportKey, UserCreatableGearKind> = {
  ride: 'bike',
  gravel_ride: 'bike',
  mountain_bike_ride: 'bike',
  ebike_ride: 'bike',
  virtual_ride: 'bike',
  run: 'shoes',
  trail_run: 'shoes',
  walk: 'shoes',
  hike: 'shoes'
}

export const isSportKey = (value: string): value is SportKey =>
  (SPORT_KEYS as readonly string[]).includes(value)

export const getSportKeysForKind = (kind: FitnessGearKind): SportKey[] =>
  SPORT_KEYS.filter((key) => SPORT_KIND[key] === kind)

export const getSportLabel = (key: string): string =>
  isSportKey(key) ? SPORT_LABELS[key] : key

/**
 * Collapses a raw activity type to a comparable token: lowercase, with every
 * separator the four vocabularies use (spaces, underscores, hyphens) removed.
 * `Gravel ride`, `GravelRide` and `gravel_ride` all become `gravelride`.
 *
 * Exported because `activityPresentation.ts` keys its own caption tables on the
 * same token. Two copies of this rule would key those tables differently from
 * `EXACT_SPORT_KEYS` the moment a fifth vocabulary needed the separator set
 * widened.
 */
export const toComparableToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Exact matches, checked before the substring heuristics below. Keys are
 * already collapsed by `toComparableToken`.
 *
 * `emountainbikeride` maps to `ebike_ride` rather than `mountain_bike_ride`
 * because an e-MTB is a physically different bike from an analog one, and the
 * electric qualifier is what decides which bike in the shed it was.
 */
const EXACT_SPORT_KEYS: Record<string, SportKey> = {
  // Strava sport_type / type
  ride: 'ride',
  gravelride: 'gravel_ride',
  mountainbikeride: 'mountain_bike_ride',
  ebikeride: 'ebike_ride',
  ebikemountainride: 'ebike_ride',
  emountainbikeride: 'ebike_ride',
  virtualride: 'virtual_ride',
  velomobile: 'ride',
  handcycle: 'ride',
  run: 'run',
  trailrun: 'trail_run',
  virtualrun: 'run',
  walk: 'walk',
  hike: 'hike',

  // FIT sport / sub_sport
  cycling: 'ride',
  gravelcycling: 'gravel_ride',
  roadcycling: 'ride',
  road: 'ride',
  mountainbiking: 'mountain_bike_ride',
  mountain: 'mountain_bike_ride',
  ebiking: 'ebike_ride',
  ebikefitness: 'ebike_ride',
  ebikemountain: 'ebike_ride',
  indoorcycling: 'virtual_ride',
  virtualactivity: 'virtual_ride',
  spin: 'virtual_ride',
  running: 'run',
  trailrunning: 'trail_run',
  trail: 'trail_run',
  treadmill: 'run',
  walking: 'walk',
  casualwalking: 'walk',
  speedwalking: 'walk',
  hiking: 'hike',

  // TCX Sport attribute. `Other` is deliberately absent: it is Garmin's
  // catch-all, so guessing a kind from it would attribute walks to a bike.
  biking: 'ride'
}

/**
 * Ordered substring rules for values the exact table does not cover. Order
 * matters: the qualified bike sports must be tested before the bare `ride`
 * rule, since `MountainBikeRide` matches both.
 */
const SUBSTRING_SPORT_RULES: ReadonlyArray<{
  matches: (token: string) => boolean
  key: SportKey
}> = [
  {
    matches: (token) => token.includes('gravel'),
    key: 'gravel_ride'
  },
  {
    matches: (token) =>
      token.startsWith('e') &&
      (token.includes('bike') || token.includes('cycl')),
    key: 'ebike_ride'
  },
  {
    matches: (token) => token.includes('electric'),
    key: 'ebike_ride'
  },
  {
    // `mountain` needs bike context here — `mountaineering` is hiking, and the
    // bare FIT `mountain` sub_sport is covered by the exact table above.
    matches: (token) =>
      token.includes('mtb') ||
      (token.includes('mountain') &&
        (token.includes('bike') || token.includes('cycl'))),
    key: 'mountain_bike_ride'
  },
  {
    matches: (token) =>
      (token.includes('virtual') ||
        token.includes('indoor') ||
        token.includes('trainer')) &&
      (token.includes('ride') ||
        token.includes('cycl') ||
        token.includes('bike')),
    key: 'virtual_ride'
  },
  {
    matches: (token) => token.includes('trail') && token.includes('run'),
    key: 'trail_run'
  },
  {
    matches: (token) =>
      token.includes('ride') ||
      token.includes('cycl') ||
      token.includes('bike'),
    key: 'ride'
  },
  {
    matches: (token) => token.includes('run'),
    key: 'run'
  },
  {
    matches: (token) => token.includes('hike'),
    key: 'hike'
  },
  {
    matches: (token) => token.includes('walk'),
    key: 'walk'
  }
]

/**
 * Maps a raw `fitness_files.activityType` to the canonical sport key gear
 * defaults are stored under, or null when the activity is not something a bike
 * or shoes are used for (swimming, gym work) or the type is unrecognisable.
 */
export const normalizeActivityTypeToSportKey = (
  rawActivityType?: string | null
): SportKey | null => {
  if (!rawActivityType) return null

  const token = toComparableToken(rawActivityType)
  if (!token) return null

  // `Object.hasOwn`, not a bare index: `EXACT_SPORT_KEYS` is an object literal,
  // so it inherits `Object.prototype`'s members. `activityType` is free-form
  // text out of a GPX file, and `constructor` would otherwise "normalize" to
  // the `Object` constructor function, returned as a `SportKey`.
  const exact = Object.hasOwn(EXACT_SPORT_KEYS, token)
    ? EXACT_SPORT_KEYS[token]
    : undefined
  if (exact) return exact

  const rule = SUBSTRING_SPORT_RULES.find(({ matches }) => matches(token))
  return rule ? rule.key : null
}

/**
 * Non-gear activity types that are stored in canonical normalized form.
 *
 * Gear default-sports model only sports a bike or shoes are used for, but the
 * overview breakdown, calendar heatmap and filters group by stored activityType.
 * We normalize common activities (training, rowing, other) to lowercase
 * canonical tokens so dialects (e.g. WeightTraining, Other, Rowing) collapse.
 */
export const NON_GEAR_STORED_ACTIVITY_TYPES = [
  'training',
  'rowing',
  'other'
] as const

export type NonGearStoredActivityType =
  (typeof NON_GEAR_STORED_ACTIVITY_TYPES)[number]

export const CANONICAL_STORED_ACTIVITY_TYPES = [
  ...SPORT_KEYS,
  ...NON_GEAR_STORED_ACTIVITY_TYPES
] as const

export type CanonicalStoredActivityType =
  (typeof CANONICAL_STORED_ACTIVITY_TYPES)[number]

export const isCanonicalStoredActivityType = (
  value: string
): value is CanonicalStoredActivityType =>
  (CANONICAL_STORED_ACTIVITY_TYPES as readonly string[]).includes(value)

const EXACT_NON_GEAR_STORED_TYPES: Record<string, NonGearStoredActivityType> = {
  // Other / Generic
  other: 'other',
  generic: 'other',

  // Rowing
  rowing: 'rowing',
  row: 'rowing',
  virtualrow: 'rowing',
  virtualrowing: 'rowing',
  indoorrowing: 'rowing',
  indoorrow: 'rowing',

  // Training / Workout / Gym / Weights / Calisthenics
  training: 'training',
  weighttraining: 'training',
  workout: 'training',
  crossfit: 'training',
  hiit: 'training',
  pilates: 'training',
  yoga: 'training',
  elliptical: 'training',
  stairstepper: 'training',
  stairclimbing: 'training',
  fitnessequipment: 'training',
  crosstraining: 'training',
  cardiotraining: 'training',
  flexibilitytraining: 'training',
  strengthtraining: 'training',
  functionalstrengthtraining: 'training',
  traditionalstrengthtraining: 'training',
  calisthenics: 'training',
  gym: 'training',
  fitness: 'training',
  weight: 'training',
  weights: 'training'
}

const SUBSTRING_NON_GEAR_RULES: ReadonlyArray<{
  matches: (token: string) => boolean
  key: NonGearStoredActivityType
}> = [
  {
    matches: (token) => token === 'other' || token === 'generic',
    key: 'other'
  },
  {
    matches: (token) =>
      token.startsWith('row') ||
      token.endsWith('row') ||
      token.includes('rowing'),
    key: 'rowing'
  },
  {
    matches: (token) =>
      token.includes('training') ||
      token.includes('workout') ||
      token.includes('crossfit') ||
      token.includes('calisthenic') ||
      token.includes('pilates') ||
      token.includes('yoga') ||
      token.includes('elliptical') ||
      token.includes('stairstepper') ||
      token.includes('strength') ||
      (token.includes('weight') && !token.includes('flyweight')) ||
      (token.includes('fitness') && !token.includes('bike')),
    key: 'training'
  }
]

const normalizeNonGearStoredActivityType = (
  rawActivityType: string
): NonGearStoredActivityType | null => {
  const token = toComparableToken(rawActivityType)
  if (!token) return null

  const exact = Object.hasOwn(EXACT_NON_GEAR_STORED_TYPES, token)
    ? EXACT_NON_GEAR_STORED_TYPES[token]
    : undefined
  if (exact) return exact

  const rule = SUBSTRING_NON_GEAR_RULES.find(({ matches }) => matches(token))
  return rule ? rule.key : null
}

/**
 * The canonical form `fitness_files.activityType` is STORED in.
 *
 * Four vocabularies reach the column (see the module header), so the same ride
 * arrived as `cycling` from a FIT file, `Biking` from a Garmin TCX and `Ride`
 * from Strava. Gear never cared — it matches through
 * `normalizeActivityTypeToSportKey` — but everything that groups or filters on
 * the raw string did: the fitness overview breakdown counted three separate
 * activities, and the per-type route-heatmap cache keyed three separate rows.
 *
 * So every write path collapses the raw value to its canonical activity type
 * before storing it, and `scripts/fitness/normalizeFitnessActivityTypes.ts`
 * does the same to history imported before this rule existed.
 *
 * Any value that does not match a known sport key, training, or rowing defaults
 * to 'other'. Missing or whitespace-only values normalize to null.
 *
 * Idempotent by construction — every canonical key normalizes to itself — which
 * is what makes the backfill script safe to rerun and lets it skip rows in one
 * comparison.
 */
export const normalizeStoredActivityType = (
  rawActivityType?: string | null
): CanonicalStoredActivityType | null => {
  if (!rawActivityType) return null

  const trimmed = rawActivityType.trim()
  if (!trimmed) return null

  const sportKey = normalizeActivityTypeToSportKey(trimmed)
  if (sportKey) return sportKey

  const nonGearType = normalizeNonGearStoredActivityType(trimmed)
  if (nonGearType) return nonGearType

  return 'other'
}

/**
 * The gear kind an activity should be attributed to, or null when unknown. The
 * gear picker uses it to narrow its options; it is a convenience, never a
 * permission — an unrecognised type must not make an activity unassignable.
 */
export const getGearKindForActivityType = (
  rawActivityType?: string | null
): FitnessGearKind | null => {
  const sportKey = normalizeActivityTypeToSportKey(rawActivityType)
  return sportKey ? SPORT_KIND[sportKey] : null
}
