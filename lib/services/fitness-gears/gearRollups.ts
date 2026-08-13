import { Database } from '@/lib/database/types'
import {
  FitnessGear,
  FitnessGearDeviceRollup,
  FitnessGearDistanceRollup
} from '@/lib/types/database/fitnessGear'

/**
 * The rollup a single gear reports, picked by kind.
 *
 * Every route that returns one gear needs this branch, and each of them getting
 * it right independently is exactly how a device would end up reporting a
 * distance of 0 km on one route and nothing at all on the next. Batch reads on
 * the list route stay batched — this is the single-gear path only.
 */
export const getRollupForGear = async (
  database: Database,
  actorId: string,
  gear: FitnessGear
): Promise<FitnessGearDistanceRollup | FitnessGearDeviceRollup> => {
  if (gear.kind === 'device') {
    const rollups = await database.getFitnessGearDeviceRollups({
      actorId,
      gearIds: [gear.id]
    })
    return rollups[gear.id]
  }

  const rollups = await database.getFitnessGearDistanceRollups({
    actorId,
    gearIds: [gear.id]
  })
  return rollups[gear.id]
}
