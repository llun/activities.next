import {
  SportKey,
  normalizeActivityTypeToSportKey
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
  virtualrun: { label: 'Indoor running', emoji: '🏃' }
}

/**
 * Fallbacks for activities the sport keys deliberately do not model, so a swim
 * still reads as a swim. Those values are stored verbatim — there is no gear
 * kind to attribute them to, but they are still real activities — and without
 * this table they would take the generic glyph below.
 *
 * Keys are collapsed the way `sportTypes.ts` collapses its own tables:
 * lowercase with every separator removed, so `lap_swimming` and `Lap Swimming`
 * both land here.
 */
const UNMODELLED_ACTIVITY_LABELS: Record<string, ActivityPresentation> = {
  swim: { label: 'Swimming', emoji: '🏊' },
  swimming: { label: 'Swimming', emoji: '🏊' },
  openwaterswimming: { label: 'Swimming', emoji: '🏊' },
  lapswimming: { label: 'Swimming', emoji: '🏊' }
}

/**
 * Names an activity for the summary line of the post an import publishes.
 *
 * Reads the type through `normalizeActivityTypeToSportKey` rather than raw,
 * because it runs on BOTH vocabularies: a new import arrives already collapsed
 * to a sport key, while a file stored before that rule — reprocessed, or not
 * yet swept by `scripts/fitness/normalizeFitnessActivityTypes.ts` — still
 * carries `cycling` or `Biking`. Matching raw strings captioned a Strava ride
 * "Ride 🏋️", and would caption a normalized gravel ride "Gravel_ride 🏋️".
 */
export const getActivityPresentation = (
  activityType?: string | null
): ActivityPresentation => {
  if (!activityType) {
    return { label: 'Workout', emoji: '🏋️' }
  }

  // `Object.hasOwn`, not a bare index, on both tables: they are object
  // literals, so they inherit `Object.prototype`. `activityType` is free-form
  // text out of the uploaded file, and a `constructor` value would otherwise
  // destructure the `Object` constructor into `{label, emoji}` and write
  // "undefined undefined — 5.20 km" into the post body.
  const token = activityType.toLowerCase().replace(/[^a-z0-9]/g, '')
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
