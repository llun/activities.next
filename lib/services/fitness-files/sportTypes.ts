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

export type FitnessGearKind = 'bike' | 'shoes'

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

export const SPORT_KIND: Record<SportKey, FitnessGearKind> = {
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
 */
const toComparableToken = (value: string): string =>
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

  const exact = EXACT_SPORT_KEYS[token]
  if (exact) return exact

  const rule = SUBSTRING_SPORT_RULES.find(({ matches }) => matches(token))
  return rule ? rule.key : null
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
