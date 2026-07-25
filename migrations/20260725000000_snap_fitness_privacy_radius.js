// Persists the fitness privacy "hide radius" snap that the runtime has been
// applying on read since the option set changed from 5/10/20/50m to
// 50/100/200/500m/1km.
//
// `sanitizePrivacyRadiusMeters` (lib/services/fitness-files/privacy.ts) rounds
// an unlisted radius UP to the next supported option, so a zone saved at 20m
// already masks 50m everywhere the app reads it. But the stored value still
// says 20, which means:
//
//   - stored and effective values disagree permanently, and nothing in the app
//     ever reconciles them; and
//   - if a future change relaxes the snap or reintroduces a sub-50m option,
//     every one of these zones silently reverts to a radius the product no
//     longer considers private, with no migration to point at.
//
// Within the supported range, snapping upward never shrinks a zone, so this
// backfill can only increase how much is hidden. (A stored radius ABOVE the
// largest option would clamp down to it, but the API has never accepted one —
// the previous option set topped out at 50m — and the runtime sanitizer clamps
// identically on read, so effective masking is unchanged either way.)
//
// The snap logic is duplicated here on purpose: migrations must not import app
// code, because they have to keep working when that code later changes. Keep it
// in step with FITNESS_PRIVACY_RADIUS_OPTIONS.
//
// NOTE FOR OPERATORS: this does not re-render route map images or heatmaps that
// were generated under the old, narrower radius. Migrations run outside the
// worker and have no queue access, so regeneration stays a deliberate action —
// use "Regenerate maps for old statuses" on the fitness privacy settings page.
//
// Run this before the new version starts serving traffic: the backfill reads a
// chunk and then writes it, so a settings save landing in between would be
// recomputed from the migration's older snapshot.
//
// Rows are read in keyset-paginated chunks (ordered by id) so peak memory stays
// bounded, and the whole backfill runs in one transaction: either every row is
// snapped or none is. Re-running is safe — already-snapped values are
// unchanged, so the migration is idempotent.

const FITNESS_PRIVACY_RADIUS_OPTIONS = [0, 50, 100, 200, 500, 1000]
const MAX_RADIUS =
  FITNESS_PRIVACY_RADIUS_OPTIONS[FITNESS_PRIVACY_RADIUS_OPTIONS.length - 1]

const CHUNK_SIZE = 500

const snapRadius = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0
  }

  return (
    FITNESS_PRIVACY_RADIUS_OPTIONS.find((option) => option >= value) ??
    MAX_RADIUS
  )
}

// SQLite hands the `json` column back as TEXT; PostgreSQL `jsonb` arrives
// already parsed. Unparseable content is left exactly as found — this migration
// must never turn a recoverable column into a lost one.
const parseLocations = (value) => {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

const snapLocations = (locations) => {
  let changed = false

  const snapped = locations.map((location) => {
    if (!location || typeof location !== 'object') return location

    // Same rule as parseLocations: never turn a value we do not understand
    // into a lost one. Writing snapRadius's 0 here would destroy, say, a
    // stringified "20" that a later fix could otherwise still coerce.
    const radius = location.hideRadiusMeters
    if (typeof radius !== 'number' || !Number.isFinite(radius)) return location

    const snappedRadius = snapRadius(radius)
    if (snappedRadius === radius) return location

    changed = true
    return { ...location, hideRadiusMeters: snappedRadius }
  })

  return changed ? snapped : null
}

export const up = async function (knex) {
  await knex.transaction(async (trx) => {
    let lastId = null
    let updatedRows = 0
    const unparseableIds = []

    for (;;) {
      const query = trx('fitness_settings')
        .select('id', 'privacyLocations', 'privacyHideRadiusMeters')
        .orderBy('id', 'asc')
        .limit(CHUNK_SIZE)

      if (lastId !== null) query.where('id', '>', lastId)

      const rows = await query
      if (rows.length === 0) break

      for (const row of rows) {
        const update = {}

        const snappedRadius = snapRadius(row.privacyHideRadiusMeters)
        if (
          row.privacyHideRadiusMeters !== null &&
          row.privacyHideRadiusMeters !== undefined &&
          snappedRadius !== row.privacyHideRadiusMeters
        ) {
          update.privacyHideRadiusMeters = snappedRadius
        }

        const locations = parseLocations(row.privacyLocations)
        if (!locations && row.privacyLocations) {
          unparseableIds.push(row.id)
        }

        if (locations) {
          const snappedLocations = snapLocations(locations)
          if (snappedLocations) {
            // Stringify for both engines: SQLite stores TEXT, and PostgreSQL
            // casts the JSON text to jsonb. This matches how the app writes it.
            update.privacyLocations = JSON.stringify(snappedLocations)
          }
        }

        if (Object.keys(update).length > 0) {
          await trx('fitness_settings').where('id', row.id).update(update)
          updatedRows += 1
        }
      }

      if (rows.length < CHUNK_SIZE) break

      lastId = rows[rows.length - 1].id
    }

    // An operator running a privacy-data rewrite should not have to guess
    // whether it did anything.
    console.log(
      `[snap_fitness_privacy_radius] snapped ${updatedRows} fitness_settings row(s)`
    )

    if (unparseableIds.length > 0) {
      // This is the one moment every row is scanned. Such a row already reads
      // as "no privacy zones" at runtime, so it is worth surfacing here rather
      // than waiting for someone to open that actor's settings.
      console.warn(
        `[snap_fitness_privacy_radius] left ${unparseableIds.length} row(s) with unparseable privacyLocations untouched — these actors currently have NO privacy zones at runtime: ${unparseableIds.join(', ')}`
      )
    }
  })
}

export const down = async function () {
  // Deliberately a no-op. The original sub-50m radii are not recoverable from
  // the snapped values, and restoring them would shrink privacy zones below the
  // minimum the product now enforces — re-exposing GPS points around a home
  // address. Rolling this migration back leaves the widened radii in place,
  // which is the safe direction.
}
