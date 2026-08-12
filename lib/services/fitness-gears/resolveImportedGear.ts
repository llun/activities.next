import { Database } from '@/lib/database/types'
import {
  FitnessGearKind,
  getGearKindForActivityType
} from '@/lib/services/fitness-files/sportTypes'
import { StravaGear, getStravaGear } from '@/lib/services/strava/activity'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/**
 * Resolves the gear an imported activity should be attributed to, creating the
 * gear row the first time an id or a name is seen.
 *
 * Both entry points are idempotent by design: imports re-run, an archive import
 * walks thousands of activities that share a handful of bikes, and the webhook
 * path can see the same activity twice. Neither ever mutates an existing gear
 * row — a name or a brand the athlete has since corrected locally stays
 * corrected.
 */

// `fitness_gears.name` is a varchar(255); a Strava name longer than that is an
// insert failure on PostgreSQL rather than a truncated row.
const MAX_GEAR_NAME_LENGTH = 255

// Trim AFTER the cut, not only before it: a 255-character slice can land in the
// middle of a space, and storing the trailing whitespace would leave the name
// we insert different from the name we look up by. `findFitnessGearByName`
// trims both sides today so the two still meet, but that is its choice to make,
// not an invariant this module should lean on — and a stored name with a
// trailing space renders as one everywhere it is shown.
const truncateGearName = (name: string): string =>
  (name.length > MAX_GEAR_NAME_LENGTH
    ? name.slice(0, MAX_GEAR_NAME_LENGTH)
    : name
  ).trim()

/**
 * The kind a Strava gear belongs to.
 *
 * Strava's gear ids are prefixed by kind — `b1234567` for a bike, `g1234567`
 * for shoes — and that prefix is the only signal available when `GET /gear/{id}`
 * fails or the gear has been deleted, so it is checked first. `frame_type` is
 * bike-only in Strava's model and backs it up. The activity's own sport is the
 * last real signal; `shoes` is the final fallback because an unknown-prefix,
 * detail-less gear is far more likely to be a pair of shoes than a bike (bikes
 * are the ones that reliably carry `frame_type`).
 *
 * ASSUMPTION: the `b`/`g` prefixes are observed Strava behaviour, not a
 * documented guarantee, and have not been verified against a live account here.
 * Getting it wrong is NOT recoverable by the owner: `kind` is deliberately
 * immutable (there is no such field on `UpdateFitnessGearParams`, and
 * `gearRequests.ts` says why), so a bike created as `shoes` shows no components
 * card at all and its service-reminder email offers shoe advice — "Most shoes
 * wear out between 500 and 800 km". The only way out is to delete the gear and
 * recreate it, losing the components and re-attributing the activities. That is
 * the cost of a wrong guess here; keep the signals ordered most-reliable-first.
 */
export const inferStravaGearKind = ({
  stravaGearId,
  gear,
  activityType
}: {
  stravaGearId: string
  gear?: StravaGear | null
  activityType?: string | null
}): FitnessGearKind => {
  const prefix = stravaGearId.trim().toLowerCase().charAt(0)
  if (prefix === 'b') return 'bike'
  if (prefix === 'g') return 'shoes'

  if (gear?.frame_type !== null && gear?.frame_type !== undefined) {
    return 'bike'
  }

  return getGearKindForActivityType(activityType) ?? 'shoes'
}

/**
 * The name to store for a Strava gear. Strava's brand/model pair is the
 * descriptive one ("Moots Routt 45"); the athlete's own nickname is the
 * fallback, and a bare placeholder keeps the activity attributable when the
 * gear detail fetch produced nothing at all.
 */
export const getStravaGearName = (
  stravaGearId: string,
  gear?: StravaGear | null
): string => {
  const brandModel = [gear?.brand_name, gear?.model_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ')
  const name = brandModel || gear?.name?.trim() || `Strava gear ${stravaGearId}`
  return truncateGearName(name)
}

/**
 * Finds — or creates — the local gear matching a Strava `gear_id`.
 *
 * Returns null only when nothing could be resolved; the caller treats that as
 * "leave the activity unattributed", never as an import failure.
 */
export const resolveStravaGear = async ({
  database,
  actorId,
  stravaGearId,
  accessToken,
  activityType
}: {
  database: Database
  actorId: string
  stravaGearId: string
  accessToken: string
  activityType?: string | null
}): Promise<{ id: string } | null> => {
  const normalizedGearId = stravaGearId.trim()
  if (!normalizedGearId) return null

  const existing = await database.findFitnessGearByStravaGearId({
    actorId,
    stravaGearId: normalizedGearId
  })
  if (existing) return { id: existing.id }

  // A gear the athlete deleted, or a token that cannot read the shed, answers
  // null — that is settled input, and a placeholder-named row still leaves the
  // activity attributable.
  //
  // A THROW is the opposite: Strava is rate-limiting (100 requests / 15 min,
  // routinely hit during the bulk webhook catch-up that is exactly when a gear
  // id is first seen) or erroring, and we know nothing about this gear yet.
  // Creating the row anyway would be permanent — the id lookup above
  // short-circuits from the next activity onwards, and this module never
  // mutates an existing gear row on purpose.
  //
  // Healing it on a later successful fetch was the alternative and is rejected:
  // it would cost an extra `GET /gear/{id}` per activity precisely while the
  // API is rate-limiting, and it could only ever repair the NAME. `kind` is
  // immutable by design (see `inferStravaGearKind`), so a gear guessed with no
  // `frame_type` to go on would stay mis-filed forever — the expensive half of
  // the mistake. Leaving the activity unattributed instead keeps
  // `fitness_files.gearId` NULL, which is precisely the state a later import's
  // `assignFitnessFileGearIfUnset` is allowed to fill in.
  let details: StravaGear | null
  try {
    details = await getStravaGear({
      gearId: normalizedGearId,
      accessToken
    })
  } catch (error) {
    logger.warn({
      message:
        'Failed to fetch Strava gear details, leaving the activity unattributed',
      actorId,
      stravaGearId: normalizedGearId,
      err: toLoggableError(error)
    })
    return null
  }

  try {
    const created = await database.createFitnessGear({
      actorId,
      kind: inferStravaGearKind({
        stravaGearId: normalizedGearId,
        gear: details,
        activityType
      }),
      name: getStravaGearName(normalizedGearId, details),
      brand: details?.brand_name?.trim() || null,
      model: details?.model_name?.trim() || null,
      stravaGearId: normalizedGearId
    })
    return { id: created.id }
  } catch (error) {
    // `(actorId, stravaGearId)` is UNIQUE, and a parallel import of two
    // activities on the same bike races here. Whoever lost re-reads the row the
    // winner inserted instead of failing the activity.
    const winner = await database.findFitnessGearByStravaGearId({
      actorId,
      stravaGearId: normalizedGearId
    })
    if (winner) return { id: winner.id }

    logger.warn({
      message: 'Failed to create gear for Strava activity',
      actorId,
      stravaGearId: normalizedGearId,
      err: toLoggableError(error)
    })
    return null
  }
}

/**
 * Finds — or creates — the local gear matching a name read out of a Strava
 * archive export. The archive carries no gear ids, only the display name the
 * athlete gave the bike or shoes, so `stravaGearId` is deliberately left unset:
 * a later webhook import that does know the id must be free to create its own
 * row rather than silently adopting a name match.
 */
export const resolveArchiveGearByName = async ({
  database,
  actorId,
  name,
  kind
}: {
  database: Database
  actorId: string
  name: string
  kind: FitnessGearKind
}): Promise<{ id: string } | null> => {
  // Truncate before the lookup, not just before the insert: searching by the
  // full name would never match the truncated row we stored, so an over-long
  // name would create a duplicate gear on every activity.
  const trimmed = truncateGearName(name.trim())
  if (!trimmed) return null

  const existing = await database.findFitnessGearByName({
    actorId,
    name: trimmed
  })
  if (existing) return { id: existing.id }

  try {
    const created = await database.createFitnessGear({
      actorId,
      kind,
      name: trimmed
    })
    return { id: created.id }
  } catch (error) {
    // No unique index covers names, but a concurrent create is still possible;
    // prefer whatever now exists over failing the activity.
    const winner = await database.findFitnessGearByName({
      actorId,
      name: trimmed
    })
    if (winner) return { id: winner.id }

    logger.warn({
      message: 'Failed to create gear for archive activity',
      actorId,
      err: toLoggableError(error)
    })
    return null
  }
}
