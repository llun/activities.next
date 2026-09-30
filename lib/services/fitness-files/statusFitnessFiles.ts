import type { StatusFitnessFileItem } from '@/lib/client/fitnessFiles'
import { Database } from '@/lib/database/types'
import { isFitnessProcessingStuck } from '@/lib/services/fitness-files/processingState'

export const getStatusFitnessFiles = async (
  database: Database,
  statusId: string,
  now: number = Date.now()
): Promise<StatusFitnessFileItem[]> => {
  if (typeof database.getFitnessFilesByStatus !== 'function') {
    return []
  }

  const files = await database.getFitnessFilesByStatus({ statusId })
  if (!files || files.length === 0) return []

  const gearIds = files
    .flatMap((file) => [file.gearId, file.deviceGearId])
    .filter((gearId): gearId is string => Boolean(gearId))
  const gearNames =
    typeof database.getFitnessGearNamesByIds === 'function' &&
    gearIds.length > 0
      ? await database.getFitnessGearNamesByIds({ ids: gearIds })
      : {}

  const items: StatusFitnessFileItem[] = files.map((file) => ({
    id: file.id,
    actorId: file.actorId,
    fileName: file.fileName,
    fileType: file.fileType,
    isPrimary: file.isPrimary ?? true,
    statusId: file.statusId ?? null,
    processingStatus: file.processingStatus ?? 'pending',
    processingStuck: isFitnessProcessingStuck(
      {
        processingStatus: file.processingStatus,
        updatedAt: file.updatedAt
      },
      now
    ),
    totalDistanceMeters: file.totalDistanceMeters ?? null,
    totalDurationSeconds: file.totalDurationSeconds ?? null,
    movingTimeSeconds: file.movingTimeSeconds ?? null,
    elevationGainMeters: file.elevationGainMeters ?? null,
    activityType: file.activityType ?? null,
    activityStartTime: file.activityStartTime ?? null,
    hasMapData: file.hasMapData ?? false,
    description: file.description ?? null,
    deviceManufacturer: file.deviceManufacturer ?? null,
    deviceName: file.deviceName ?? null,
    sourceUrl: file.sourceUrl ?? null,
    gearId: file.gearId ?? null,
    gearName: file.gearId ? (gearNames[file.gearId] ?? null) : null,
    deviceGearId: file.deviceGearId ?? null,
    deviceGearName: file.deviceGearId
      ? (gearNames[file.deviceGearId] ?? null)
      : null,
    avgPower: file.avgPower ?? null,
    maxPower: file.maxPower ?? null,
    avgHeartRate: file.avgHeartRate ?? null,
    maxHeartRate: file.maxHeartRate ?? null,
    totalWorkKj: file.totalWorkKj ?? null,
    elevationSeries: file.elevationSeries ?? null
  }))

  return items
}
