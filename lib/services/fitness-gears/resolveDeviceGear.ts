import { Database } from '@/lib/database/types'
import { buildDeviceGearSeed } from '@/lib/services/fitness-gears/deviceIdentity'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/**
 * Finds — or creates — the `kind: 'device'` gear row for the head unit or watch
 * an activity was recorded on.
 *
 * Three invariants hold here and are what make the function safe to call from
 * an import job that re-runs:
 *
 * 1. **It never mutates an existing row.** A device's name, brand, model and
 *    product page are the owner's to edit; re-importing an archive must not
 *    overwrite "the Edge" back to "Garmin Edge 840". Only the identity
 *    (`deviceKey`) is derived from the file, and that is create-only.
 * 2. **It is idempotent.** The lookup is by `deviceKey`, which is a pure
 *    function of the recorded fields, so a thousand rides on the same head unit
 *    resolve to one row.
 * 3. **It returns null rather than throwing.** Most GPX files carry no device
 *    information at all, and a device row is a nicety on top of an activity —
 *    losing one must never fail the import that would otherwise have succeeded.
 *
 * Devices are the only gear kind this function may create, and it is the only
 * thing that may create them (`POST /api/v1/fitness/gear` rejects `device`) —
 * a hand-made device row would carry no `deviceKey` and so would match no
 * upload, sitting empty forever.
 */
export const resolveDeviceGear = async ({
  database,
  actorId,
  deviceName,
  deviceManufacturer
}: {
  database: Database
  actorId: string
  deviceName?: string | null
  deviceManufacturer?: string | null
}): Promise<{ id: string } | null> => {
  const seed = buildDeviceGearSeed(deviceName, deviceManufacturer)
  // No usable identity — an activity with no device information, or one whose
  // only device field is a raw FIT code nothing recognises. Creating nothing is
  // the correct outcome, not a failure.
  if (!seed) return null

  try {
    const existing = await database.findFitnessGearByDeviceKey({
      actorId,
      deviceKey: seed.deviceKey
    })
    if (existing) return { id: existing.id }
  } catch (error) {
    logger.warn({
      message: 'Failed to look up the recording device for an activity',
      actorId,
      deviceKey: seed.deviceKey,
      err: toLoggableError(error)
    })
    return null
  }

  try {
    const created = await database.createFitnessGear({
      actorId,
      kind: 'device',
      name: seed.name,
      brand: seed.brand,
      model: seed.model,
      deviceKey: seed.deviceKey,
      productUrl: seed.productUrl
    })
    return { id: created.id }
  } catch (error) {
    // `(actorId, deviceKey)` is UNIQUE, and two activities from the same head
    // unit imported in parallel race here. Whoever loses re-reads the row the
    // winner inserted rather than dropping the link for that activity.
    const winner = await database
      .findFitnessGearByDeviceKey({ actorId, deviceKey: seed.deviceKey })
      .catch(() => null)
    if (winner) return { id: winner.id }

    logger.warn({
      message: 'Failed to create the recording device for an activity',
      actorId,
      deviceKey: seed.deviceKey,
      err: toLoggableError(error)
    })
    return null
  }
}

/**
 * Resolves the recording device and stamps `fitness_files.deviceGearId` with it.
 * The one helper every import path calls, so the four of them cannot drift.
 *
 * Best-effort throughout: attribution is metadata on an activity that has
 * already been parsed and stored, so nothing in here may fail the import.
 *
 * The write is an unconditional overwrite rather than the `whereNull` guard
 * `assignFitnessFileGearIfUnset` uses for bikes and shoes, and that difference
 * is deliberate. Which bike a ride was on is a judgement the owner may correct;
 * which head unit recorded it is a fact the file states, so re-running a job or
 * re-importing an archive converges on the same row instead of preserving a
 * stale one. Nothing else writes this column.
 */
export const linkFitnessFileDeviceGear = async ({
  database,
  actorId,
  fitnessFileId,
  deviceName,
  deviceManufacturer
}: {
  database: Database
  actorId: string
  fitnessFileId: string
  deviceName?: string | null
  deviceManufacturer?: string | null
}): Promise<string | null> => {
  try {
    const device = await resolveDeviceGear({
      database,
      actorId,
      deviceName,
      deviceManufacturer
    })
    if (!device) return null

    await database.updateFitnessFileActivityData(fitnessFileId, {
      deviceGearId: device.id
    })
    return device.id
  } catch (error) {
    logger.warn({
      message: 'Failed to link the recording device to a fitness file',
      actorId,
      fitnessFileId,
      err: toLoggableError(error)
    })
    return null
  }
}
