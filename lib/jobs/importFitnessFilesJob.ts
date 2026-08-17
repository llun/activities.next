import { z } from 'zod'

import {
  statusRecipientsCC,
  statusRecipientsTo
} from '@/lib/actions/createNote'
import { Database } from '@/lib/database/types'
import { groupFitnessActivitiesByOverlap } from '@/lib/jobs/fitnessImportOverlap'
import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import { deleteEmailMapImage } from '@/lib/services/fitness-files/emailMapImage'
import { toImportErrorMessage } from '@/lib/services/fitness-files/importError'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import { linkFitnessFileDeviceGear } from '@/lib/services/fitness-gears/resolveDeviceGear'
import { getQueue } from '@/lib/services/queue'
import { JobMessage } from '@/lib/services/queue/type'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Mention } from '@/lib/types/activitypub'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { Actor, getMention } from '@/lib/types/domain/actor'
import { getLocalStatusId } from '@/lib/utils/activitypubId'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
import { generatePublicId } from '@/lib/utils/publicId'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { createJobHandle } from './createJobHandle'
import { IMPORT_FITNESS_FILES_JOB_NAME } from './names'

const Visibility = z.enum(['public', 'unlisted', 'private', 'direct'])

const JobData = z.object({
  actorId: z.string(),
  batchId: z.string(),
  fitnessFileIds: z.array(z.string()).min(1),
  overlapFitnessFileIds: z.array(z.string()).default([]),
  visibility: Visibility.default('public'),
  // Whether a completed import here should email the actor.
  //
  // Set by the ORIGINATING publisher, never inferred here. This job is the
  // single funnel for every bulk import in the repo — the Strava archive
  // walker, the multi-file upload endpoint, the retry-all path and the
  // recovery scripts all come through it — and each of those is a batch where
  // "a status was newly created" is true for every activity in it. Inferring
  // the flag from that would mail once per activity: a 500-ride archive import
  // would send 500 emails.
  //
  // Only an unattended, single-activity import sets it: the Strava webhook.
  // Defaulting to false means a new caller is silent until it opts in, which is
  // the safe direction to be wrong in.
  notifyOnComplete: z.boolean().optional().default(false),
  // Whether a status newly created here should federate its Create.
  //
  // Same reasoning as notifyOnComplete, and set by the same single caller: this
  // job funnels every bulk import, so inferring the flag from "a status was
  // created" would deliver one Create per activity — a 500-ride archive import
  // would flood every follower's timeline. Only the Strava webhook, which
  // carries exactly one freshly recorded activity, opts in.
  //
  // An import that reuses an existing status never federates regardless of this
  // flag: see the publishSendNote expression on the process job below.
  publishSendNote: z.boolean().optional().default(false)
})

const ACTOR_NOT_FOUND_IMPORT_ERROR = 'Actor not found for fitness import'
const MISSING_FITNESS_FILE_IMPORT_ERROR = 'Fitness file missing during import'

type ParsedImportFileSource = 'target' | 'overlap'

interface ParsedImportFile {
  fitnessFile: FitnessFile
  totalDurationSeconds: number
  startTimeMs?: number
  source: ParsedImportFileSource
  hasCoordinates?: boolean
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

const selectPrimaryTargetFile = (
  orderedTargetGroup: ParsedImportFile[]
): ParsedImportFile => {
  const outdoorFiles = orderedTargetGroup.filter((item) => item.hasCoordinates)

  if (outdoorFiles.length === 0) {
    return orderedTargetGroup[0]
  }

  const sorted = [...outdoorFiles]
    .map((file) => ({ file, tiebreak: Math.random() }))
    .sort((a, b) => {
      if (a.file.totalDurationSeconds !== b.file.totalDurationSeconds) {
        return b.file.totalDurationSeconds - a.file.totalDurationSeconds
      }

      const startA = a.file.startTimeMs ?? Number.MAX_SAFE_INTEGER
      const startB = b.file.startTimeMs ?? Number.MAX_SAFE_INTEGER
      if (startA !== startB) {
        return startA - startB
      }

      return a.tiebreak - b.tiebreak
    })
    .map(({ file }) => file)

  return sorted[0]
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
    hasCoordinates: fitnessFile.hasMapData ?? false,
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
  // Both writes target `importError` on the same row, so they must agree on the
  // value — otherwise whichever lands last decides the reason.
  await Promise.all([
    database.updateFitnessFileImportStatus(
      fitnessFileId,
      'failed',
      importError
    ),
    database.updateFitnessFileProcessingStatus(
      fitnessFileId,
      'failed',
      importError
    )
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
  // Backdated to the activity's start time so the URI tail sorts with the
  // activity, matching the createdAt passed to database.createNote below.
  const postId = generatePublicId(createdAt)
  const statusId = getLocalStatusId({ actorId: actor.id, statusId: postId })

  const createdStatus = await database.createNote({
    id: statusId,
    url: `https://${actor.domain}/${getMention(actor)}/${postId}`,
    publicId: postId,
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

export interface ImportedFitnessGroup {
  statusId: string
  statusCreated: boolean
  primaryFitnessFileId: string
  // The PROCESS_FITNESS_FILE_JOB message this group needs, with
  // publishSendNote/notifyOnComplete already resolved against the existing
  // status. Null when the group's primary file is not among this run's targets
  // — a merge into a sibling's post, which must not reprocess it.
  processJob: JobMessage | null
}

export interface ImportFitnessFilesOptions {
  // Return each group's PROCESS_FITNESS_FILE_JOB instead of publishing it, so
  // the caller can publish once the status content is complete.
  //
  // Deliberately an option of this function rather than a JobData field: a
  // queued caller never sees the return value, so deferring there would drop
  // the process job entirely. Only the inline Strava caller sets it.
  deferProcessJobPublishes?: boolean
}

export type ImportFitnessFilesData = z.input<typeof JobData>

export const importFitnessFiles = async (
  database: Database,
  data: ImportFitnessFilesData,
  options: ImportFitnessFilesOptions = {}
): Promise<ImportedFitnessGroup[]> => {
  const {
    actorId,
    batchId,
    fitnessFileIds,
    overlapFitnessFileIds,
    visibility,
    notifyOnComplete,
    publishSendNote
  } = JobData.parse(data)

  const importedGroups: ImportedFitnessGroup[] = []

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

    return importedGroups
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
      const buffer = await getFitnessFileBuffer(
        database,
        fitnessFile.id,
        fitnessFile
      )
      if (!isParseableFitnessFileType(fitnessFile.fileType)) {
        throw new Error(
          `Unsupported fitness file type for activity parsing: ${fitnessFile.fileType}`
        )
      }
      const activityData = await parseFitnessFile({
        fileType: fitnessFile.fileType,
        buffer
      })

      // Same reason as processFitnessFileJob: the reset below de-references
      // any copy stored for an earlier import of this row, and a file that
      // ends up non-primary never reaches processFitnessFileJob to rewrite it.
      await deleteEmailMapImage({
        database,
        fitnessFileId: fitnessFile.id,
        mapImageEmailPath: fitnessFile.mapImageEmailPath
      })

      await database.updateFitnessFileActivityData(fitnessFile.id, {
        totalDistanceMeters: activityData.totalDistanceMeters,
        totalDurationSeconds: activityData.totalDurationSeconds,
        movingTimeSeconds: activityData.movingTimeSeconds ?? null,
        elevationGainMeters: activityData.elevationGainMeters,
        activityType: activityData.activityType,
        activityStartTime: activityData.startTime ?? null,
        hasMapData: false,
        mapImagePath: null,
        mapImageEmailPath: null,
        // The map is being redone from scratch, so a reason recorded for the
        // previous one is stale. Left behind it would keep the status looking
        // retriable forever — including on a file that ends up non-primary
        // and is never supposed to own a map at all.
        mapError: null,
        ...(activityData.deviceManufacturer !== undefined
          ? { deviceManufacturer: activityData.deviceManufacturer }
          : {}),
        ...(activityData.deviceName !== undefined
          ? { deviceName: activityData.deviceName }
          : {})
      })

      await linkFitnessFileDeviceGear({
        database,
        actorId,
        fitnessFileId: fitnessFile.id,
        deviceName: activityData.deviceName ?? fitnessFile.deviceName,
        deviceManufacturer:
          activityData.deviceManufacturer ?? fitnessFile.deviceManufacturer
      })

      parsedFiles.push({
        fitnessFile,
        totalDurationSeconds: activityData.totalDurationSeconds,
        source: 'target',
        hasCoordinates: activityData.coordinates.length >= 2,
        ...(activityData.startTime
          ? { startTimeMs: activityData.startTime.getTime() }
          : null)
      })
    } catch (error) {
      const errorMessage = toImportErrorMessage(error)

      logger.warn({
        message: 'Failed to parse fitness file during import',
        fitnessFileId,
        actorId,
        batchId,
        error: errorMessage
      })

      await markImportFileFailed(database, fitnessFile.id, errorMessage)
    }
  }

  if (!parsedFiles.some((item) => item.source === 'target')) {
    return importedGroups
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
    const primaryTargetFile = selectPrimaryTargetFile(orderedTargetGroup)
    const earliestTargetFile = orderedTargetGroup[0]
    const createdAt =
      earliestTargetFile.startTimeMs ?? earliestTargetFile.fitnessFile.createdAt
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

      const processJob = targetFitnessFileIds.includes(primaryFitnessFileId)
        ? {
            id: getHashFromString(
              `${status.id}:${primaryFitnessFileId}:process-fitness`
            ),
            name: PROCESS_FITNESS_FILE_JOB_NAME,
            data: {
              actorId,
              statusId: status.id,
              fitnessFileId: primaryFitnessFileId,
              // Both conditions, for the same reason as notifyOnComplete
              // below: the Create has to go out exactly once, and only for a
              // status this run created. Retries and the recovery scripts
              // re-run over statuses that are already live, whose Create (if
              // there was one) has already been delivered.
              publishSendNote: publishSendNote && !existingStatus,
              // Both conditions: the caller has to be one that emails at all,
              // AND this has to be a genuine first import rather than a
              // reprocess of a status that already exists.
              notifyOnComplete: notifyOnComplete && !existingStatus
            }
          }
        : null

      if (processJob && !options.deferProcessJobPublishes) {
        await getQueue().publish(processJob)
      }

      importedGroups.push({
        statusId: status.id,
        statusCreated: !existingStatus,
        primaryFitnessFileId,
        processJob
      })
    } catch (error) {
      // Must not be `(error as Error).message`: this block covers the queue
      // publish, and a non-Error rejection would make the reason `undefined`,
      // which updateFitnessFileImportStatus writes as NULL — wiping any prior
      // reason and leaving the file `failed` with no explanation.
      const errorMessage = toImportErrorMessage(error)

      logger.error({
        message: 'Failed to create local status for imported fitness files',
        actorId,
        batchId,
        fitnessFileIds: targetFitnessFileIds,
        error: errorMessage,
        err: toLoggableError(error)
      })

      await Promise.all(
        orderedTargetGroup.map((item) =>
          markImportFileFailed(database, item.fitnessFile.id, errorMessage)
        )
      )

      if (createdStatusId) {
        try {
          await database.deleteStatus({ statusId: createdStatusId })
        } catch (cleanupError) {
          logger.error({
            message: 'Failed to cleanup local status after import failure',
            actorId,
            batchId,
            statusId: createdStatusId,
            err: toLoggableError(cleanupError)
          })
        }
      }
    }
  }

  return importedGroups
}

export const importFitnessFilesJob = createJobHandle(
  IMPORT_FITNESS_FILES_JOB_NAME,
  async (database, message) => {
    // JobData.parse inside still validates the shape; the cast only restores
    // compile-time checking for the direct caller, which passes a literal.
    await importFitnessFiles(database, message.data as ImportFitnessFilesData)
  }
)
