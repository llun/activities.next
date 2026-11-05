import { Database } from '@/lib/database/types'
import type { TrainingZoneSettings } from '@/lib/fitness/trainingZones'

/**
 * An actor's training zone inputs from their `general` fitness settings, or
 * null when they set none. Only these three fields leave the row: it also
 * holds the actor's privacy locations.
 */
export const getTrainingZoneSettings = async (
  database: Database,
  actorId: string
): Promise<TrainingZoneSettings | null> => {
  const settings = await database.getFitnessSettings({
    actorId,
    serviceType: 'general'
  })
  const zones = {
    maxHeartRate: settings?.maxHeartRate ?? null,
    restingHeartRate: settings?.restingHeartRate ?? null,
    functionalThresholdPower: settings?.functionalThresholdPower ?? null
  }
  return Object.values(zones).some((value) => value !== null) ? zones : null
}
