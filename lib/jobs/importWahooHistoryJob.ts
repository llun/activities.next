import { z } from 'zod'

import { Database } from '@/lib/database/types'
import {
  IMPORT_WAHOO_ACTIVITY_JOB_NAME,
  IMPORT_WAHOO_HISTORY_JOB_NAME
} from '@/lib/jobs/names'
import { withImportLock } from '@/lib/services/fitness-files/importLock'
import { getQueue } from '@/lib/services/queue'
import {
  WahooRateLimitError,
  getWahooWorkoutsPage
} from '@/lib/services/wahoo/api'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { createJobHandle } from './createJobHandle'

const JobData = z.object({ historyId: z.string().uuid() })

const importPage = async (database: Database, historyId: string) => {
  const history = await database.getWahooHistoryImport(historyId)
  if (!history || history.status === 'cancelled' || history.scanComplete) return

  const settings = await database.getFitnessSettings({
    actorId: history.actorId,
    serviceType: 'wahoo'
  })
  if (
    !settings?.accessToken ||
    settings.providerUserId !== history.providerUserId
  ) {
    throw new Error('Wahoo connection is unavailable for history import')
  }
  const page = await getWahooWorkoutsPage(database, settings, history.nextPage)
  const from = Date.parse(`${history.fromDate}T00:00:00.000Z`)
  const to = Date.parse(`${history.toDate}T23:59:59.999Z`)
  let reachedOlder = false

  for (const workout of page.workouts) {
    const starts = workout.starts ? Date.parse(workout.starts) : NaN
    if (!Number.isFinite(starts)) continue
    if (starts < from) {
      reachedOlder = true
      continue
    }
    if (starts > to) continue

    const latestHistory = await database.getWahooHistoryImport(historyId)
    if (latestHistory?.status === 'cancelled') return
    const record = await database.upsertWahooImport({
      actorId: history.actorId,
      providerUserId: history.providerUserId,
      workoutId: String(workout.id),
      summaryId: workout.workout_summary
        ? String(workout.workout_summary.id)
        : undefined,
      historyImportId: history.id
    })
    if (record.hadStatus && !record.statusId) continue
    if (record.status === 'completed') {
      // A deleted local post remains a tombstone. A live post can accept a
      // newer FIT revision without producing a second post or notification.
      if (!record.statusId) continue
      const newSummaryId = workout.workout_summary
        ? String(workout.workout_summary.id)
        : undefined
      const newRevision = workout.workout_summary?.updated_at
        ? Date.parse(workout.workout_summary.updated_at)
        : NaN
      const hasNewRevision =
        (newSummaryId && newSummaryId !== record.summaryId) ||
        (Number.isFinite(newRevision) &&
          (!record.summaryUpdatedAt || newRevision > record.summaryUpdatedAt))
      if (!hasNewRevision) continue
      await database.updateWahooImport(record.id, { status: 'pending' })
    }
    await getQueue().publish({
      id: crypto.randomUUID(),
      name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
      data: { importId: record.id, notifyOnComplete: false }
    })
  }

  const counts = await database.countWahooHistoryItems(historyId)
  const scanComplete =
    reachedOlder ||
    page.workouts.length === 0 ||
    history.nextPage * page.per_page >= page.total
  const advanced = await database.updateWahooHistoryImport(
    historyId,
    {
      nextPage: history.nextPage + 1,
      total: counts.total,
      scanComplete,
      status: 'running',
      lastError: null
    },
    ['pending', 'running']
  )
  if (!advanced) return
  if (!scanComplete) {
    const current = await database.getWahooHistoryImport(historyId)
    if (current?.status === 'cancelled') return
    await getQueue().publish({
      id: crypto.randomUUID(),
      name: IMPORT_WAHOO_HISTORY_JOB_NAME,
      data: { historyId }
    })
  }
}

export const importWahooHistoryJob = createJobHandle(
  IMPORT_WAHOO_HISTORY_JOB_NAME,
  async (database, message) => {
    const { historyId } = JobData.parse(message.data)
    try {
      await withImportLock(
        database,
        `wahoo-history:${historyId}`,
        () => importPage(database, historyId),
        { failOnTimeout: true, ttlMs: 5 * 60 * 1000 }
      )
    } catch (error) {
      if (error instanceof WahooRateLimitError) {
        const current = await database.getWahooHistoryImport(historyId)
        if (current?.status === 'cancelled') return
        await getQueue().publish({
          id: crypto.randomUUID(),
          name: IMPORT_WAHOO_HISTORY_JOB_NAME,
          data: { historyId },
          delaySeconds: error.retryAfterSeconds
        })
        return
      }
      await database.updateWahooHistoryImport(
        historyId,
        {
          status: 'failed',
          lastError: 'Wahoo history scan failed. Retry to continue.'
        },
        ['pending', 'running']
      )
      logger.error({
        message: 'Wahoo history import failed',
        historyId,
        err: toLoggableError(error)
      })
      throw error
    }
  }
)
