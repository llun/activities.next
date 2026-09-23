import { z } from 'zod'

import { Database } from '@/lib/database/types'
import {
  IMPORT_WAHOO_ACTIVITY_JOB_NAME,
  IMPORT_WAHOO_HISTORY_JOB_NAME
} from '@/lib/jobs/names'
import { withImportLock } from '@/lib/services/fitness-files/importLock'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = Date.parse(`${value}T00:00:00.000Z`)
    return (
      Number.isFinite(parsed) &&
      new Date(parsed).toISOString().slice(0, 10) === value
    )
  })
const StartSchema = z.object({ fromDate: DateSchema, toDate: DateSchema })

const getSummary = async (database: Database, actorId: string) => {
  const history = await database.getLatestWahooHistoryImport(actorId)
  if (!history) return null
  const counts = await database.countWahooHistoryItems(history.id)
  let status = history.status
  if (
    history.scanComplete &&
    counts.pending === 0 &&
    (status === 'running' || status === 'pending')
  ) {
    status = counts.failed > 0 ? 'failed' : 'completed'
    await database.updateWahooHistoryImport(history.id, { status })
  }
  return {
    id: history.id,
    status,
    fromDate: history.fromDate,
    toDate: history.toDate,
    total: counts.total,
    completed: counts.completed,
    failed: counts.failed,
    lastError: history.lastError
  }
}

export const GET = traceApiRoute(
  'getWahooHistory',
  AuthenticatedGuard(async (req, { currentActor, database }) =>
    apiResponse({
      req,
      allowedMethods: [],
      data: { import: await getSummary(database, currentActor.id) }
    })
  )
)

export const POST = traceApiRoute(
  'startWahooHistory',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    if (getQueue().runsInline) return apiErrorResponse(503)
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(400)
    }
    const parsed = StartSchema.safeParse(body)
    if (!parsed.success || parsed.data.fromDate > parsed.data.toDate) {
      return apiErrorResponse(422)
    }
    const settings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'wahoo'
    })
    if (!settings?.accessToken || !settings.providerUserId) {
      return apiErrorResponse(409)
    }

    try {
      const result = await withImportLock(
        database,
        `wahoo-history-start:${currentActor.id}`,
        async () => {
          const existing = await database.getLatestWahooHistoryImport(
            currentActor.id
          )
          if (existing && ['pending', 'running'].includes(existing.status)) {
            const counts = await database.countWahooHistoryItems(existing.id)
            if (!existing.scanComplete || counts.pending > 0) return null
          }
          const history = await database.createWahooHistoryImport({
            actorId: currentActor.id,
            providerUserId: settings.providerUserId!,
            ...parsed.data
          })
          try {
            await getQueue().publish({
              id: crypto.randomUUID(),
              name: IMPORT_WAHOO_HISTORY_JOB_NAME,
              data: { historyId: history.id }
            })
          } catch (error) {
            await database.updateWahooHistoryImport(history.id, {
              status: 'failed',
              lastError: 'Failed to queue history import. Retry from settings.'
            })
            throw error
          }
          return history
        },
        { failOnTimeout: true }
      )
      if (!result) return apiErrorResponse(409)
      return apiResponse({ req, allowedMethods: [], data: { success: true } })
    } catch {
      return apiErrorResponse(503)
    }
  })
)

export const DELETE = traceApiRoute(
  'cancelWahooHistory',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const history = await database.getLatestWahooHistoryImport(currentActor.id)
    if (history && ['pending', 'running', 'failed'].includes(history.status)) {
      await database.updateWahooHistoryImport(history.id, {
        status: 'cancelled'
      })
    }
    return apiResponse({ req, allowedMethods: [], data: { success: true } })
  })
)

export const PATCH = traceApiRoute(
  'retryWahooHistory',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    if (getQueue().runsInline) return apiErrorResponse(503)
    const history = await database.getLatestWahooHistoryImport(currentActor.id)
    const settings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'wahoo'
    })
    if (
      !history ||
      !settings?.accessToken ||
      settings.providerUserId !== history.providerUserId ||
      !['failed', 'cancelled'].includes(history.status)
    )
      return apiErrorResponse(409)

    try {
      await withImportLock(
        database,
        `wahoo-history-start:${currentActor.id}`,
        async () => {
          const latest = await database.getWahooHistoryImport(history.id)
          if (!latest || !['failed', 'cancelled'].includes(latest.status)) {
            throw new Error('Wahoo history is already running')
          }
          const retryItems = await database.getWahooImportsByHistory(
            history.id,
            ['failed', 'unsupported', 'pending']
          )
          await database.updateWahooHistoryImport(history.id, {
            status: 'running',
            lastError: null
          })
          try {
            for (const item of retryItems) {
              if (item.status !== 'pending') {
                await database.markWahooImportPending(item.id)
              }
              await getQueue().publish({
                id: crypto.randomUUID(),
                name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
                data: { importId: item.id, notifyOnComplete: false }
              })
            }
            if (!history.scanComplete) {
              await getQueue().publish({
                id: crypto.randomUUID(),
                name: IMPORT_WAHOO_HISTORY_JOB_NAME,
                data: { historyId: history.id }
              })
            }
          } catch (error) {
            await database.updateWahooHistoryImport(history.id, {
              status: 'failed',
              lastError: 'Failed to queue history retry. Retry from settings.'
            })
            throw error
          }
        },
        { failOnTimeout: true }
      )
    } catch {
      return apiErrorResponse(503)
    }
    return apiResponse({ req, allowedMethods: [], data: { success: true } })
  })
)
