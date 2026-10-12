import { Database } from '@/lib/database/types'

// Creates a completed, primary activity attributed to `gearId` — the only
// shape the rollups count.
export const createActivity = async (
  db: Database,
  {
    actorId,
    pathSuffix,
    distanceMeters,
    activityStartTime,
    gearId,
    processingStatus = 'completed',
    isPrimary = true
  }: {
    actorId: string
    pathSuffix: string
    distanceMeters: number
    activityStartTime?: Date
    gearId?: string
    processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
    isPrimary?: boolean
  }
) => {
  const file = await db.createFitnessFile({
    actorId,
    path: `fitness/gear-${pathSuffix}.fit`,
    fileName: `gear-${pathSuffix}.fit`,
    fileType: 'fit',
    mimeType: 'application/vnd.ant.fit',
    bytes: 1024
  })
  await db.updateFitnessFileActivityData(file!.id, {
    activityType: 'cycling',
    activityStartTime: activityStartTime ?? null,
    totalDistanceMeters: distanceMeters
  })
  await db.updateFitnessFileProcessingStatus(file!.id, processingStatus)
  if (!isPrimary) {
    await db.updateFitnessFilePrimary(file!.id, false)
  }
  if (gearId) {
    await db.assignFitnessFileGearIfUnset({
      fitnessFileId: file!.id,
      actorId,
      gearId
    })
  }
  return file!
}
