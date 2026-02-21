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
  overlapFitnessFileIds: z.array(z.string()).default([]),
  visibility: Visibility.default('public')
})

const ACTOR_NOT_FOUND_IMPORT_ERROR = 'Actor not found for fitness import'
const MISSING_FITNESS_FILE_IMPORT_ERROR = 'Fitness file missing during import'

type ParsedImportFileSource = 'target' | 'overlap'

interface ParsedImportFile {
  fitnessFile: FitnessFile
  totalDurationSeconds: number
  startTimeMs?: number
  source: ParsedImportFileSource
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

const buildParsedFileFromStoredActivity = ({
  fitnessFile,
  source
}: {
  fitnessFile: FitnessFile
  source: ParsedImportFileSource
}): ParsedImportFile | null => {
  if (
    typeof fitnessFile.totalDurationSeconds !== 'number' ||
    fitnessFile.totalDurationSeconds <= 0
  ) {
    return null
  }

  return {
    fitnessFile,
    totalDurationSeconds: fitnessFile.totalDurationSeconds,
    source,
    ...(typeof fitnessFile.activityStartTime === 'number'
      ? { startTimeMs: fitnessFile.activityStartTime }
      : null)
  }
}

const groupFilesByOverlap = (
  files: ParsedImportFile[]
): ParsedImportFile[][] => {
  const withTimestamps = files.filter(
    (item) =>
      typeof item.startTimeMs === 'number' && item.totalDurationSeconds > 0
  )
  const withoutTimestamps = files.filter(
    (item) =>
      typeof item.startTimeMs !== 'number' || item.totalDurationSeconds <= 0
  )

  const fileById = new Map(
    withTimestamps.map((item) => [item.fitnessFile.id, item])
  )
  const overlapGroups = groupFitnessActivitiesByOverlap(
    withTimestamps.map((item) => ({
      id: item.fitnessFile.id,
      startTimeMs: item.startTimeMs as number,
      durationSeconds: item.totalDurationSeconds
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
    const {
      actorId,
      batchId,
      fitnessFileIds,
      overlapFitnessFileIds,
      visibility
    } = JobData.parse(message.data)

    const actor = await database.getActorFromId({ id: actorId })
    if (!actor) {
      logger.error({
        message: ACTOR_NOT_FOUND_IMPORT_ERROR,
        actorId,
        batchId
      })

      await Promise.all([
        database.updateFitnessFilesImportStatus({
          fitnessFileIds,
          importStatus: 'failed',
          importError: ACTOR_NOT_FOUND_IMPORT_ERROR
        }),
        database.updateFitnessFilesProcessingStatus({
          fitnessFileIds,
          processingStatus: 'failed'
        })
      ])

      return
    }

    const parsedFiles: ParsedImportFile[] = []
    const targetFitnessFileIdSet = new Set(fitnessFileIds)
    const allFitnessFileIds = Array.from(
      new Set([...fitnessFileIds, ...overlapFitnessFileIds])
    )
    const fitnessFiles = await database.getFitnessFilesByIds({
      fitnessFileIds: allFitnessFileIds
    })
    const fitnessFileById = new Map(
      fitnessFiles.map((fitnessFile) => [fitnessFile.id, fitnessFile])
    )

    for (const fitnessFileId of allFitnessFileIds) {
      const fitnessFile = fitnessFileById.get(fitnessFileId)
      const isTargetFile = targetFitnessFileIdSet.has(fitnessFileId)

      if (!fitnessFile) {
        logger.warn({
          message: MISSING_FITNESS_FILE_IMPORT_ERROR,
          fitnessFileId,
          actorId,
          batchId
        })

        if (isTargetFile) {
          await markImportFileFailed(
            database,
            fitnessFileId,
            MISSING_FITNESS_FILE_IMPORT_ERROR
          )
        }

        continue
      }

      if (fitnessFile.actorId !== actorId) {
        if (isTargetFile) {
          await markImportFileFailed(
            database,
            fitnessFile.id,
            'Fitness file does not belong to actor'
          )
        }
        continue
      }

      if (!isTargetFile) {
        const parsedFromStoredActivity = buildParsedFileFromStoredActivity({
          fitnessFile,
          source: 'overlap'
        })

        if (parsedFromStoredActivity) {
          parsedFiles.push(parsedFromStoredActivity)
        }

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
          totalDurationSeconds: activityData.totalDurationSeconds,
          source: 'target',
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

    if (!parsedFiles.some((item) => item.source === 'target')) {
      return
    }

    const groups = groupFilesByOverlap(parsedFiles)

    for (const group of groups) {
      const orderedGroup = sortFilesByActivityStart(group)
      const orderedTargetGroup = sortFilesByActivityStart(
        group.filter((item) => item.source === 'target')
      )

      if (orderedTargetGroup.length === 0) {
        continue
      }

      const targetFitnessFileIds = orderedTargetGroup.map(
        (item) => item.fitnessFile.id
      )
      const primaryTargetFile = orderedTargetGroup[0]
      const createdAt =
        primaryTargetFile.startTimeMs ?? primaryTargetFile.fitnessFile.createdAt
      let createdStatusId: string | null = null

      try {
        const existingStatusId =
          orderedGroup.find((item) => item.fitnessFile.statusId)?.fitnessFile
            .statusId ?? null

        const existingStatus = existingStatusId
          ? await database.getStatus({
              statusId: existingStatusId,
              withReplies: false
            })
          : null

        const existingPrimaryFileId =
          existingStatus &&
          orderedGroup.find(
            (item) =>
              item.fitnessFile.statusId === existingStatus.id &&
              item.fitnessFile.isPrimary
          )?.fitnessFile.id

        const status =
          existingStatus ??
          (await createLocalOnlyFitnessStatus({
            actor,
            createdAt,
            visibility,
            database
          }))
        if (!existingStatus) {
          createdStatusId = status.id
        }

        const primaryFitnessFileId =
          existingPrimaryFileId ?? primaryTargetFile.fitnessFile.id

        await database.assignFitnessFilesToImportedStatus({
          fitnessFileIds: targetFitnessFileIds,
          primaryFitnessFileId,
          statusId: status.id
        })

        if (targetFitnessFileIds.includes(primaryFitnessFileId)) {
          await getQueue().publish({
            id: getHashFromString(
              `${status.id}:${primaryFitnessFileId}:process-fitness`
            ),
            name: PROCESS_FITNESS_FILE_JOB_NAME,
            data: {
              actorId,
              statusId: status.id,
              fitnessFileId: primaryFitnessFileId,
              publishSendNote: false
            }
          })
        }
      } catch (error) {
        const nodeError = error as Error
        logger.error({
          message: 'Failed to create local status for imported fitness files',
          actorId,
          batchId,
          fitnessFileIds: targetFitnessFileIds,
          error: nodeError.message
        })

        await Promise.all(
          orderedTargetGroup.map((item) =>
            markImportFileFailed(
              database,
              item.fitnessFile.id,
              nodeError.message
            )
          )
        )

        if (createdStatusId) {
          try {
            await database.deleteStatus({ statusId: createdStatusId })
          } catch (cleanupError) {
            const nodeCleanupError = cleanupError as Error
            logger.error({
              message: 'Failed to cleanup local status after import failure',
              actorId,
              batchId,
              statusId: createdStatusId,
              error: nodeCleanupError.message
            })
          }
        }
      }
    }
  }
)
