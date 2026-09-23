import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { DEFAULT_FITNESS_MAX_FILE_SIZE } from '@/lib/config/fitnessStorage'
import { Database } from '@/lib/database/types'
import { getOverlapContextFitnessFileIds } from '@/lib/jobs/fitnessImportOverlap'
import { importFitnessFiles } from '@/lib/jobs/importFitnessFilesJob'
import { IMPORT_WAHOO_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { saveFitnessFile } from '@/lib/services/fitness-files'
import { toImportErrorMessage } from '@/lib/services/fitness-files/importError'
import { withImportLock } from '@/lib/services/fitness-files/importLock'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { getQueue } from '@/lib/services/queue'
import {
  WahooRateLimitError,
  getWahooWorkout,
  getWahooWorkoutSummary
} from '@/lib/services/wahoo/api'
import { logger } from '@/lib/utils/logger'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'
import { readResponseArrayBufferWithLimit } from '@/lib/utils/streamLimit'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { createJobHandle } from './createJobHandle'

const JobData = z.object({
  importId: z.string().uuid(),
  notifyOnComplete: z.boolean().optional().default(false),
  ignoreHistoryCancellation: z.boolean().optional().default(false)
})

const toTime = (value?: string | null) => {
  const time = value ? Date.parse(value) : NaN
  return Number.isFinite(time) ? time : undefined
}

const getDuration = (
  summary: { duration_total_accum?: string | null },
  minutes?: number
) => {
  const seconds = Number(summary.duration_total_accum)
  return Number.isFinite(seconds) && seconds > 0
    ? seconds
    : Math.max(0, (minutes ?? 0) * 60)
}

const readWahooFit = async (url: string): Promise<Buffer> => {
  // safeImageFetch is the existing guarded binary-download path: it checks
  // every redirect and rejects local addresses. Never send the OAuth token to
  // a file URL returned by the Wahoo API.
  const response = await safeImageFetch(url, {
    timeoutMs: 15_000,
    signal: AbortSignal.timeout(60_000)
  })
  if (!response?.ok) throw new Error('Wahoo FIT download is unavailable')
  const maxBytes =
    getConfig().fitnessStorage?.maxFileSize ?? DEFAULT_FITNESS_MAX_FILE_SIZE
  const bytes = Buffer.from(
    await readResponseArrayBufferWithLimit(response, maxBytes, 'Wahoo FIT file')
  )
  if (bytes.length < 12 || bytes.toString('ascii', 8, 12) !== '.FIT') {
    throw new Error('Wahoo workout does not contain a valid FIT file')
  }
  await parseFitnessFile({ fileType: 'fit', buffer: bytes })
  return bytes
}

const processImport = async (
  database: Database,
  importId: string,
  notifyOnComplete: boolean,
  ignoreHistoryCancellation: boolean
) => {
  const record = await database.getWahooImport(importId)
  if (!record) return
  if (!ignoreHistoryCancellation && record.historyImportId) {
    const history = await database.getWahooHistoryImport(record.historyImportId)
    if (history?.status === 'cancelled') return
  }
  const settings = await database.getFitnessSettings({
    actorId: record.actorId,
    serviceType: 'wahoo'
  })
  const actor = await database.getActorFromId({ id: record.actorId })
  if (
    !settings?.accessToken ||
    settings.providerUserId !== record.providerUserId ||
    !actor
  ) {
    throw new Error('Wahoo connection or actor is unavailable')
  }

  if (record.hadStatus && !record.statusId) return
  const workout = await getWahooWorkout(database, settings, record.workoutId)
  const summary = workout.workout_summary?.file?.url
    ? workout.workout_summary
    : await getWahooWorkoutSummary(database, settings, record.workoutId)
  const summaryId = String(summary.id)
  const summaryUpdatedAt = toTime(summary.updated_at)
  if (
    record.status === 'completed' &&
    record.summaryId === summaryId &&
    (!summaryUpdatedAt ||
      (record.summaryUpdatedAt !== undefined &&
        summaryUpdatedAt <= record.summaryUpdatedAt))
  ) {
    return
  }
  const fileUrl = summary.file?.url
  const persistedFile = record.fitnessFileId
    ? await database.getFitnessFile({ id: record.fitnessFileId })
    : null
  const sameRevisionFile =
    persistedFile &&
    record.summaryId === summaryId &&
    (!summaryUpdatedAt || record.summaryUpdatedAt === summaryUpdatedAt)
  if (!fileUrl && !sameRevisionFile)
    throw new Error('Wahoo workout summary has no FIT file yet')
  const bytes = sameRevisionFile ? null : await readWahooFit(fileUrl!)
  const startTime = toTime(workout.starts)
  const duration = getDuration(summary, workout.minutes)

  await withImportLock(
    database,
    `wahoo-import:${record.id}`,
    async () => {
      const latest = await database.getWahooImport(record.id)
      if (!latest || (latest.hadStatus && !latest.statusId)) return
      if (!ignoreHistoryCancellation && latest.historyImportId) {
        const history = await database.getWahooHistoryImport(
          latest.historyImportId
        )
        if (history?.status === 'cancelled') return
      }
      if (
        latest.status === 'completed' &&
        latest.summaryId === summaryId &&
        (!summaryUpdatedAt ||
          (latest.summaryUpdatedAt !== undefined &&
            summaryUpdatedAt <= latest.summaryUpdatedAt))
      )
        return

      await database.updateWahooImport(record.id, {
        status: 'running',
        attempts: latest.attempts + 1,
        lastError: null
      })
      const batchId = `wahoo:${record.id}:${summaryId}:${summaryUpdatedAt ?? 0}`
      const reuseFile =
        latest.fitnessFileId &&
        latest.summaryId === summaryId &&
        (!summaryUpdatedAt || latest.summaryUpdatedAt === summaryUpdatedAt)
      let fitnessFileId = reuseFile ? latest.fitnessFileId : undefined
      if (fitnessFileId) {
        const persisted = await database.getFitnessFile({ id: fitnessFileId })
        if (!persisted) fitnessFileId = undefined
      }
      if (!fitnessFileId) {
        const batchFiles = await database.getFitnessFilesByBatchId({ batchId })
        fitnessFileId = batchFiles.find(
          (item) => item.actorId === record.actorId
        )?.id
      }
      if (!fitnessFileId) {
        if (!bytes) throw new Error('Wahoo FIT file must be downloaded again')
        const file = new File(
          [new Uint8Array(bytes)],
          `wahoo-${record.id}.fit`,
          { type: 'application/octet-stream' }
        )
        const saved = await saveFitnessFile(database, actor, {
          file,
          importBatchId: batchId,
          description: workout.name ?? undefined
        })
        if (!saved) throw new Error('Failed to save Wahoo FIT file')
        fitnessFileId = saved.id
      }
      await database.updateWahooImport(record.id, {
        fitnessFileId,
        summaryId,
        ...(summaryUpdatedAt ? { summaryUpdatedAt } : {})
      })
      if (startTime || duration > 0) {
        await database.updateFitnessFileActivityData(fitnessFileId, {
          ...(startTime ? { activityStartTime: new Date(startTime) } : {}),
          ...(duration > 0 ? { totalDurationSeconds: duration } : {})
        })
      }

      const groups = await withImportLock(
        database,
        `fitness-import:${record.actorId}`,
        async () => {
          const liveSettings = await database.getFitnessSettings({
            actorId: record.actorId,
            serviceType: 'wahoo'
          })
          if (
            !liveSettings?.accessToken ||
            liveSettings.id !== settings.id ||
            liveSettings.providerUserId !== record.providerUserId
          ) {
            throw new Error('Wahoo connection was removed during import')
          }
          const dateWindow = Math.max(duration * 1000 * 2, 60 * 60 * 1000)
          const candidates = await database.getFitnessFilesByActor({
            actorId: record.actorId,
            ...(startTime
              ? {
                  startDate: new Date(startTime - dateWindow),
                  endDate: new Date(startTime + dateWindow)
                }
              : {}),
            limit: 1000
          })
          const overlapFitnessFileIds = getOverlapContextFitnessFileIds({
            actorId: record.actorId,
            fitnessFileId,
            activityStartTime: startTime,
            activityDurationSeconds: duration,
            files: candidates
          })
          return importFitnessFiles(
            database,
            {
              actorId: record.actorId,
              batchId,
              fitnessFileIds: [fitnessFileId],
              overlapFitnessFileIds,
              visibility: settings.defaultVisibility ?? 'private',
              notifyOnComplete: notifyOnComplete && !latest.statusId,
              publishSendNote: notifyOnComplete && !latest.statusId,
              postAtImportTime: notifyOnComplete && !latest.statusId,
              preferRicherPrimary: true,
              replacePrimaryFileId:
                latest.fitnessFileId !== fitnessFileId
                  ? latest.fitnessFileId
                  : undefined,
              expectedExistingStatusId: latest.hadStatus
                ? latest.statusId
                : undefined
            },
            { deferProcessJobPublishes: true }
          )
        },
        { failOnTimeout: true, ttlMs: 5 * 60 * 1000 }
      )

      const importedFile = await database.getFitnessFile({ id: fitnessFileId })
      if (!importedFile?.statusId) {
        throw new Error('Wahoo FIT import did not create an activity')
      }
      await database.updateWahooImport(record.id, {
        fitnessFileId,
        statusId: importedFile.statusId,
        summaryId,
        ...(summaryUpdatedAt ? { summaryUpdatedAt } : {}),
        status: 'running',
        lastError: null
      })

      for (const group of groups) {
        if (!group.processJob) continue
        try {
          await getQueue().publish(group.processJob)
        } catch (error) {
          const errorMessage = toImportErrorMessage(error)
          await database.updateFitnessFileProcessingStatus(
            fitnessFileId,
            'failed',
            errorMessage
          )
          throw error
        }
      }
      await database.updateWahooImport(record.id, {
        status: 'completed',
        lastError: null
      })
      await database.updateFitnessSettings({
        id: settings.id,
        lastImportAt: Date.now(),
        connectionError: null
      })
    },
    { failOnTimeout: true, ttlMs: 5 * 60 * 1000 }
  )
}

export const importWahooActivityJob = createJobHandle(
  IMPORT_WAHOO_ACTIVITY_JOB_NAME,
  async (database, message) => {
    const { importId, notifyOnComplete, ignoreHistoryCancellation } =
      JobData.parse(message.data)
    try {
      await processImport(
        database,
        importId,
        notifyOnComplete,
        ignoreHistoryCancellation
      )
    } catch (error) {
      if (error instanceof WahooRateLimitError) {
        await getQueue().publish({
          id: crypto.randomUUID(),
          name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
          data: { importId, notifyOnComplete, ignoreHistoryCancellation },
          delaySeconds: error.retryAfterSeconds
        })
        return
      }
      const reason = toImportErrorMessage(error)
        .replace(/https?:\/\/\S+/gi, '[remote URL]')
        .slice(0, 500)
      await database.markWahooImportFailed(
        importId,
        reason.includes('no FIT file yet') ? 'unsupported' : 'failed',
        reason
      )
      logger.error({
        message: 'Wahoo activity import failed',
        importId,
        error: reason,
        err: toLoggableError(error)
      })
      throw error
    }
  }
)
