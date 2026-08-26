import {
  SportKey,
  normalizeActivityTypeToSportKey,
  toComparableToken
} from '@/lib/services/fitness-files/sportTypes'

/**
 * How an activity type is named in the post an import publishes.
 *
 * Lives beside `sportTypes.ts` rather than inside the import job because it
 * has to speak the same vocabulary the column is stored in, and because the
 * job is not the only thing that will ever want to name a sport.
 */
export interface ActivityPresentation {
  label: string
  emoji: string
}

/**
 * One label and glyph per sport key, keyed on `SportKey` so a sport added to
 * `sportTypes.ts` is a type error here until it is named.
 *
 * Deliberately NOT `SPORT_LABELS`, even though both name the same nine sports.
 * That table labels UI chrome, where a noun fits a chip ("Ride"); this one
 * writes the summary line of a published post, where the surrounding sentence
 * wants a gerund — "🏃 Running — 5.20 km in 28:15 min". Those strings are
 * federated and stored forever, so the wording here is what the pre-sport-key
 * table already produced for the vocabularies it covered; only the gaps it left
 * (every Strava spelling, and every qualified bike sport) are new.
 */
const SPORT_PRESENTATION: Record<SportKey, ActivityPresentation> = {
  ride: { label: 'Cycling', emoji: '🚴' },
  gravel_ride: { label: 'Gravel cycling', emoji: '🚴' },
  mountain_bike_ride: { label: 'Mountain biking', emoji: '🚵' },
  ebike_ride: { label: 'E-bike cycling', emoji: '🚴' },
  virtual_ride: { label: 'Indoor cycling', emoji: '🚴' },
  run: { label: 'Running', emoji: '🏃' },
  trail_run: { label: 'Trail running', emoji: '🏃' },
  walk: { label: 'Walking', emoji: '🚶' },
  hike: { label: 'Hiking', emoji: '🥾' }
}

/**
 * Sports whose caption must stay more specific than their sport key.
 *
 * A sport key answers "which bike or which shoes", so `normalizeActivityTypeToSportKey`
 * folds a handcycle and a velomobile into plain `ride` — correct for gear, since
 * they are attributed to a bike like any other. A caption is not answering that
 * question, and "Cycling" erases a distinction the athlete made: a handcycle is
 * hand-powered, and calling it cycling is both less accurate and less
 * respectful. `VirtualRun` likewise loses the indoor qualifier that
 * `VirtualRide` keeps, only because the keys model `virtual_ride` and no
 * `virtual_run`.
 *
 * Checked BEFORE the sport-key lookup, since these do resolve to a key and
 * would never reach the unmodelled table below.
 */
const SPECIFIC_ACTIVITY_LABELS: Record<string, ActivityPresentation> = {
  handcycle: { label: 'Handcycling', emoji: '🚴' },
  velomobile: { label: 'Velomobile', emoji: '🚴' },
  virtualrun: { label: 'Indoor running', emoji: '🏃' },
  virtualrow: { label: 'Indoor rowing', emoji: '🚣' }
}

/**
 * Fallbacks for activities the sport keys deliberately do not model, so a swim,
 * rowing, training, or other session still reads appropriately. Those values
 * are stored in their canonical form (or verbatim for unmapped sports) — there
 * is no gear kind to attribute them to, but they are still real activities —
 * and without this table they would take the generic fallback below.
 *
 * Keys are collapsed the way `sportTypes.ts` collapses its own tables:
 * lowercase with every separator removed, so `lap_swimming` and `Lap Swimming`
 * both land here.
 */
const UNMODELLED_ACTIVITY_LABELS: Record<string, ActivityPresentation> = {
  // Swimming
  swim: { label: 'Swimming', emoji: '🏊' },
  swimming: { label: 'Swimming', emoji: '🏊' },
  openwaterswimming: { label: 'Swimming', emoji: '🏊' },
  lapswimming: { label: 'Swimming', emoji: '🏊' },

  // Rowing & Paddling
  rowing: { label: 'Rowing', emoji: '🚣' },
  row: { label: 'Rowing', emoji: '🚣' },
  kayaking: { label: 'Kayaking', emoji: '🚣' },
  canoeing: { label: 'Canoeing', emoji: '🚣' },
  paddling: { label: 'Paddling', emoji: '🚣' },

  // Yoga & Mind-Body
  yoga: { label: 'Yoga', emoji: '🧘' },
  pilates: { label: 'Pilates', emoji: '🧘' },
  meditation: { label: 'Meditation', emoji: '🧘' },
  breathwork: { label: 'Breathwork', emoji: '🧘' },

  // Climbing
  climbing: { label: 'Climbing', emoji: '🧗' },
  rockclimbing: { label: 'Rock climbing', emoji: '🧗' },
  bouldering: { label: 'Bouldering', emoji: '🧗' },

  // Winter Sports & Skiing
  ski: { label: 'Skiing', emoji: '⛷️' },
  skiing: { label: 'Skiing', emoji: '⛷️' },
  alpineski: { label: 'Alpine skiing', emoji: '⛷️' },
  backcountryski: { label: 'Backcountry skiing', emoji: '⛷️' },
  nordicski: { label: 'Nordic skiing', emoji: '⛷️' },
  rollerski: { label: 'Roller skiing', emoji: '⛷️' },
  snowboard: { label: 'Snowboarding', emoji: '🏂' },
  snowboarding: { label: 'Snowboarding', emoji: '🏂' },
  snowshoe: { label: 'Snowshoeing', emoji: '❄️' },
  snowshoeing: { label: 'Snowshoeing', emoji: '❄️' },

  // Skating
  skating: { label: 'Skating', emoji: '⛸️' },
  iceskate: { label: 'Ice skating', emoji: '⛸️' },
  iceskating: { label: 'Ice skating', emoji: '⛸️' },
  inlineskate: { label: 'Inline skating', emoji: '🛼' },
  inlineskating: { label: 'Inline skating', emoji: '🛼' },
  rollerskate: { label: 'Roller skating', emoji: '🛼' },
  rollerskating: { label: 'Roller skating', emoji: '🛼' },
  skateboard: { label: 'Skateboarding', emoji: '🛹' },
  skateboarding: { label: 'Skateboarding', emoji: '🛹' },

  // Water Sports & Surfing
  surfing: { label: 'Surfing', emoji: '🏄' },
  windsurfing: { label: 'Windsurfing', emoji: '🏄' },
  kitesurfing: { label: 'Kitesurfing', emoji: '🏄' },
  standuppaddling: { label: 'Stand up paddling', emoji: '🏄' },
  scubadiving: { label: 'Scuba diving', emoji: '🤿' },
  snorkeling: { label: 'Snorkeling', emoji: '🤿' },

  // Racket Sports
  racket_sports: { label: 'Racket sports', emoji: '🎾' },
  racketsports: { label: 'Racket sports', emoji: '🎾' },
  tennis: { label: 'Tennis', emoji: '🎾' },
  pickleball: { label: 'Pickleball', emoji: '🎾' },
  padel: { label: 'Padel', emoji: '🎾' },
  squash: { label: 'Squash', emoji: '🎾' },
  badminton: { label: 'Badminton', emoji: '🏸' },
  tabletennis: { label: 'Table tennis', emoji: '🏓' },

  // Martial Arts & Boxing
  martial_arts: { label: 'Martial arts', emoji: '🥊' },
  martialarts: { label: 'Martial arts', emoji: '🥊' },
  boxing: { label: 'Boxing', emoji: '🥊' },
  kickboxing: { label: 'Kickboxing', emoji: '🥊' },
  karate: { label: 'Karate', emoji: '🥋' },
  judo: { label: 'Judo', emoji: '🥋' },

  // Team Sports
  team_sports: { label: 'Team sports', emoji: '⚽' },
  teamsports: { label: 'Team sports', emoji: '⚽' },
  soccer: { label: 'Soccer', emoji: '⚽' },
  football: { label: 'Football', emoji: '🏈' },
  basketball: { label: 'Basketball', emoji: '🏀' },
  volleyball: { label: 'Volleyball', emoji: '🏐' },
  rugby: { label: 'Rugby', emoji: '🏉' },
  baseball: { label: 'Baseball', emoji: '⚾' },

  // Golf
  golf: { label: 'Golf', emoji: '⛳' },

  // Training / Workout / Gym / Weights
  training: { label: 'Training', emoji: '🏋️' },
  weighttraining: { label: 'Weight training', emoji: '🏋️' },
  workout: { label: 'Workout', emoji: '🏋️' },
  crossfit: { label: 'Crossfit', emoji: '🏋️' },
  hiit: { label: 'HIIT', emoji: '🏋️' },

  // Other
  other: { label: 'Other', emoji: '🏋️' }
}

/**
 * Names an activity for the summary line of the post an import publishes.
 *
 * Resolves in three steps — a raw spelling that must stay specific, then the
 * sport key, then a sport no key models — because it runs on BOTH
 * vocabularies. A caller may hand it the source file's own word
 * (`cycling`, `Biking`, `MountainBikeRide`) or the canonical key the column
 * stores (`ride`), and the same activity has to caption identically either
 * way. Matching raw strings alone captioned a Strava ride "Ride 🏋️"; matching
 * only the key would caption a normalized gravel ride "Gravel_ride 🏋️".
 */
export const getActivityPresentation = (
  activityType?: string | null
): ActivityPresentation => {
  if (!activityType) {
    return { label: 'Workout', emoji: '🏋️' }
  }

  // The same collapsing `sportTypes.ts` keys its own tables on, imported rather
  // than repeated so the two cannot drift apart.
  const token = toComparableToken(activityType)

  // `Object.hasOwn`, not a bare index, on both tables below: they are object
  // literals, so they inherit `Object.prototype`. `activityType` is free-form
  // text out of the uploaded file, and a `constructor` value would otherwise
  // destructure the `Object` constructor into `{label, emoji}` and write
  // "undefined undefined — 5.20 km" into the post body.
  if (Object.hasOwn(SPECIFIC_ACTIVITY_LABELS, token)) {
    return SPECIFIC_ACTIVITY_LABELS[token]
  }

  const sportKey = normalizeActivityTypeToSportKey(activityType)
  if (sportKey) {
    return SPORT_PRESENTATION[sportKey]
  }

  if (Object.hasOwn(UNMODELLED_ACTIVITY_LABELS, token)) {
    return UNMODELLED_ACTIVITY_LABELS[token]
  }

  const trimmed = activityType.trim()
  if (!trimmed) {
    return { label: 'Workout', emoji: '🏋️' }
  }

  return {
    label: `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`,
    emoji: '🏋️'
  }
}

/**
 * The stored activity type as UI chrome names it: the column's own word with
 * separators dropped and every word capitalised (`gravel_ride` → "Gravel
 * Ride").
 *
 * Deliberately NOT `getActivityPresentation(type).label`. That table captions a
 * published post, where several stored spellings folding onto one caption is
 * the point — `ride` and `cycling` both read "Cycling". A UI list names one row
 * per stored value and, on the fitness overview, that name is the link that
 * filters by that exact value, so the fold would print two identically named
 * rows carrying different numbers and different filters.
 *
 * It narrows the fold rather than removing it: capitalising is itself
 * case-insensitive, so `ride` and `Ride` — both real, since the canonical form
 * is applied on write and older rows keep whatever Strava sent — still land on
 * one label. Use `buildActivityTypeLabels` wherever the values are rendered as
 * a SET, which is what makes the survivors distinguishable.
 */
export const formatActivityTypeLabel = (type: string): string =>
  type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())

/**
 * One display label per stored activity type, disambiguated against the others
 * it is rendered beside.
 *
 * `formatActivityTypeLabel` cannot be injective — it case-folds, so an actor
 * holding both `Ride` (imported from Strava before the canonical form was
 * applied on write) and `ride` gets two rows reading "Ride". On the fitness
 * overview those rows carry different numbers and link to different filters,
 * so identical names make two controls that cannot be told apart, and the one
 * the reader picks silently omits the other's activities.
 *
 * Only a colliding label is qualified, with the stored value that produced it,
 * so the ordinary instance — where every label is already unique — renders
 * exactly as before. Keyed on the raw stored value because that is what the
 * caller holds and what the filter compares against.
 */
export const buildActivityTypeLabels = (
  activityTypes: string[]
): Map<string, string> => {
  const typesByLabel = new Map<string, Set<string>>()
  for (const activityType of activityTypes) {
    const label = formatActivityTypeLabel(activityType)
    const collidingTypes = typesByLabel.get(label) ?? new Set<string>()
    collidingTypes.add(activityType)
    typesByLabel.set(label, collidingTypes)
  }

  return new Map(
    activityTypes.map((activityType) => {
      const label = formatActivityTypeLabel(activityType)
      const isAmbiguous = (typesByLabel.get(label)?.size ?? 0) > 1
      return [activityType, isAmbiguous ? `${label} (${activityType})` : label]
    })
  )
}
