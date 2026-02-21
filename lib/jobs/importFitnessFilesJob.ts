import crypto from 'crypto'
import { z } from 'zod'

import {
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { Database } from '@/lib/database/types'
import { groupFitnessActivitiesByOverlap } from '@/lib/jobs/fitnessImportOverlap'
import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import type { FitnessActivityData } from '@/lib/services/fitness-files/parseFitnessFile'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Mention } from '@/lib/types/activitypub'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { Actor, getMention } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { IMPORT_FITNESS_FILES_JOB_NAME } from './names'

const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

const JobData = z.object({
  actorId: z.string(),
  batchId: z.string(),
  fitnessFileIds: z.array(z.string()).min(1),
  visibility: Visibility.default('public')
})

interface ParsedImportFile {
  fitnessFile: FitnessFile
  activityData: FitnessActivityData
  startTimeMs?: number
}

const getFitnessFileBuffer = async (
  database: Database,
  fitnessFile: FitnessFile
): Promise<Buffer> => {
  const data = await getFitnessFile(database, fitnessFile.id, fitnessFile)
  if (!data) {
    throw new Error('Fitness file not found in storage')
  }

  if (data.type === 'buffer') {
    return data.buffer
  }

  const response = await fetch(data.redirectUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to download fitness file from redirect URL (${response.status})`
    )
  }

  return Buffer.from(await response.arrayBuffer())
}

const sortFilesByActivityStart = (files: ParsedImportFile[]) => {
  return [...files].sort((first, second) => {
    const firstStart = first.startTimeMs ?? Number.MAX_SAFE_INTEGER
    const secondStart = second.startTimeMs ?? Number.MAX_SAFE_INTEGER

    if (firstStart !== secondStart) {
      return firstStart - secondStart
    }

    if (first.fitnessFile.createdAt !== second.fitnessFile.createdAt) {
      return first.fitnessFile.createdAt - second.fitnessFile.createdAt
    }

    return first.fitnessFile.id.localeCompare(second.fitnessFile.id)
  })
}

const groupFilesByOverlap = (
  files: ParsedImportFile[]
): ParsedImportFile[][] => {
  const withTimestamps = files.filter(
    (item) =>
      typeof item.startTimeMs === 'number' &&
      item.activityData.totalDurationSeconds > 0
  )
  const withoutTimestamps = files.filter(
    (item) =>
      typeof item.startTimeMs !== 'number' ||
      item.activityData.totalDurationSeconds <= 0
  )

  const fileById = new Map(
    withTimestamps.map((item) => [item.fitnessFile.id, item])
  )
  const overlapGroups = groupFitnessActivitiesByOverlap(
    withTimestamps.map((item) => ({
      id: item.fitnessFile.id,
      startTimeMs: item.startTimeMs as number,
      durationSeconds: item.activityData.totalDurationSeconds
    })),
    0.8
  )

  return [
    ...overlapGroups.map((group) =>
      group
        .map((entry) => fileById.get(entry.id))
        .filter((item): item is ParsedImportFile => Boolean(item))
    ),
    ...withoutTimestamps.map((item) => [item])
  ].sort((firstGroup, secondGroup) => {
    const firstStart = firstGroup[0]?.startTimeMs ?? Number.MAX_SAFE_INTEGER
    const secondStart = secondGroup[0]?.startTimeMs ?? Number.MAX_SAFE_INTEGER
    return firstStart - secondStart
  })
}

const markImportFileFailed = async (
  database: Database,
  fitnessFileId: string,
  importError: string
) => {
  await Promise.all([
    database.updateFitnessFileImportStatus(
      fitnessFileId,
      'failed',
      importError
    ),
    database.updateFitnessFileProcessingStatus(fitnessFileId, 'failed')
  ])
}

const createLocalOnlyFitnessStatus = async ({
  actor,
  createdAt,
  visibility,
  database
}: {
  actor: Actor
  createdAt: number
  visibility: MastodonVisibility
  database: Database
}) => {
  const mentions: Mention[] = []
  const to = statusRecipientsTo(actor, mentions, null, visibility)
  const cc = statusRecipientsCC(actor, mentions, null, visibility)
  const postId = crypto.randomUUID()
  const statusId = `${actor.id}/statuses/${postId}`

  const createdStatus = await database.createNote({
    id: statusId,
    url: `https://${actor.domain}/${getMention(actor)}/${postId}`,
    actorId: actor.id,
    text: '',
    summary: null,
    to,
    cc,
    reply: '',
    createdAt
  })

  await addStatusToTimelines(database, createdStatus)

  return createdStatus
}

export const importFitnessFilesJob = createJobHandle(
  IMPORT_FITNESS_FILES_JOB_NAME,
  async (database, message) => {
    const { actorId, batchId, fitnessFileIds, visibility } = JobData.parse(
      message.data
    )

    const actor = await database.getActorFromId({ id: actorId })
    if (!actor) {
      logger.error({
        message: 'Actor not found for fitness import',
        actorId,
        batchId
      })

      return
    }

    const parsedFiles: ParsedImportFile[] = []

    for (const fitnessFileId of fitnessFileIds) {
      const fitnessFile = await database.getFitnessFile({ id: fitnessFileId })
      if (!fitnessFile) {
        logger.warn({
          message: 'Fitness file missing during import',
          fitnessFileId,
          actorId,
          batchId
        })
        continue
      }

      if (fitnessFile.actorId !== actorId) {
        await markImportFileFailed(
          database,
          fitnessFile.id,
          'Fitness file does not belong to actor'
        )
        continue
      }

      try {
        const buffer = await getFitnessFileBuffer(database, fitnessFile)
        const activityData = await parseFitnessFile({
          fileType: fitnessFile.fileType,
          buffer
        })

        await database.updateFitnessFileActivityData(fitnessFile.id, {
          totalDistanceMeters: activityData.totalDistanceMeters,
          totalDurationSeconds: activityData.totalDurationSeconds,
          elevationGainMeters: activityData.elevationGainMeters,
          activityType: activityData.activityType,
          activityStartTime: activityData.startTime ?? null,
          hasMapData: false,
          mapImagePath: null
        })

        parsedFiles.push({
          fitnessFile,
          activityData,
          ...(activityData.startTime
            ? { startTimeMs: activityData.startTime.getTime() }
            : null)
        })
      } catch (error) {
        const nodeError = error as Error
        logger.warn({
          message: 'Failed to parse fitness file during import',
          fitnessFileId,
          actorId,
          batchId,
          error: nodeError.message
        })

        await markImportFileFailed(database, fitnessFile.id, nodeError.message)
      }
    }

    if (parsedFiles.length === 0) {
      return
    }

    const groups = groupFilesByOverlap(parsedFiles)

    for (const group of groups) {
      const orderedGroup = sortFilesByActivityStart(group)
      const primaryFile = orderedGroup[0]
      const createdAt =
        primaryFile.startTimeMs ?? primaryFile.fitnessFile.createdAt

      try {
        const status = await createLocalOnlyFitnessStatus({
          actor,
          createdAt,
          visibility,
          database
        })

        await Promise.all(
          orderedGroup.map(async (item) => {
            const isPrimary = item.fitnessFile.id === primaryFile.fitnessFile.id

            await Promise.all([
              database.updateFitnessFileStatus(item.fitnessFile.id, status.id),
              database.updateFitnessFilePrimary(item.fitnessFile.id, isPrimary),
              database.updateFitnessFileImportStatus(
                item.fitnessFile.id,
                'completed'
              ),
              database.updateFitnessFileProcessingStatus(
                item.fitnessFile.id,
                isPrimary ? 'pending' : 'completed'
              )
            ])
          })
        )

        await getQueue().publish({
          id: getHashFromString(
            `${status.id}:${primaryFile.fitnessFile.id}:process-fitness`
          ),
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: {
            actorId,
            statusId: status.id,
            fitnessFileId: primaryFile.fitnessFile.id,
            publishSendNote: false
          }
        })
      } catch (error) {
        const nodeError = error as Error
        logger.error({
          message: 'Failed to create local status for imported fitness files',
          actorId,
          batchId,
          fitnessFileIds: orderedGroup.map((item) => item.fitnessFile.id),
          error: nodeError.message
        })

        await Promise.all(
          orderedGroup.map((item) =>
            markImportFileFailed(
              database,
              item.fitnessFile.id,
              nodeError.message
            )
          )
        )
      }
    }
  }
)
