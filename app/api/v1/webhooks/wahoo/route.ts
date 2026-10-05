import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { IMPORT_WAHOO_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import {
  SMALL_REQUEST_BODY_MAX_BYTES,
  isRequestBodyTooLargeError,
  readRequestTextWithLimit
} from '@/lib/utils/boundedRequestBody'
import { logger } from '@/lib/utils/logger'
import { apiResponse } from '@/lib/utils/response'
import { timingSafeStringEqual } from '@/lib/utils/timingSafeStringEqual'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const EnvelopeSchema = z.object({
  event_type: z.string(),
  webhook_token: z.string().min(8).max(255),
  user: z.object({ id: z.union([z.string(), z.number().int()]) })
})
const SummaryEventSchema = EnvelopeSchema.extend({
  workout_summary: z.object({
    id: z.union([z.string(), z.number().int()]),
    updated_at: z.string().optional(),
    workout: z.object({ id: z.union([z.string(), z.number().int()]) })
  })
})

export const POST = traceApiRoute('wahooWebhook', async (req) => {
  const queue = getQueue()
  if (queue.runsInline) {
    return apiResponse({
      req,
      allowedMethods: [],
      data: { error: 'Durable queue required for Wahoo webhooks' },
      responseStatusCode: 503
    })
  }

  // Unauthenticated: bound the body before it is buffered and parsed.
  let payload: unknown
  try {
    payload = JSON.parse(
      await readRequestTextWithLimit(req, SMALL_REQUEST_BODY_MAX_BYTES)
    )
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Payload Too Large' },
        responseStatusCode: 413
      })
    }
    return apiResponse({
      req,
      allowedMethods: [],
      data: { error: 'Invalid webhook payload' },
      responseStatusCode: 400
    })
  }
  const parsed = EnvelopeSchema.safeParse(payload)
  if (!parsed.success) {
    return apiResponse({
      req,
      allowedMethods: [],
      data: { error: 'Invalid webhook payload' },
      responseStatusCode: 400
    })
  }

  const event = parsed.data
  const database = await getDatabase()
  if (!database) {
    return apiResponse({
      req,
      allowedMethods: [],
      data: { error: 'Database unavailable' },
      responseStatusCode: 503
    })
  }

  const providerUserId = String(event.user.id)
  const settings = await database.getWahooSettingsByWebhookToken(
    event.webhook_token,
    providerUserId
  )
  if (
    !settings?.accessToken ||
    !timingSafeStringEqual(event.webhook_token, settings.webhookToken)
  ) {
    return apiResponse({
      req,
      allowedMethods: [],
      data: { error: 'Invalid webhook' },
      responseStatusCode: 403
    })
  }

  await database.updateFitnessSettings({
    id: settings.id,
    lastWebhookAt: Date.now()
  })
  if (event.event_type !== 'workout_summary') {
    return apiResponse({ req, allowedMethods: [], data: { success: true } })
  }

  const summaryParsed = SummaryEventSchema.safeParse(payload)
  if (!summaryParsed.success) {
    return apiResponse({
      req,
      allowedMethods: [],
      data: { error: 'Invalid workout summary event' },
      responseStatusCode: 400
    })
  }

  const summaryEvent = summaryParsed.data
  const workoutId = String(summaryEvent.workout_summary.workout.id)
  const summaryId = String(summaryEvent.workout_summary.id)
  const revision = summaryEvent.workout_summary.updated_at
    ? Date.parse(summaryEvent.workout_summary.updated_at)
    : undefined
  const summaryUpdatedAt =
    revision && Number.isFinite(revision) ? revision : undefined

  let acceptedImportId: string | undefined
  try {
    const record = await database.upsertWahooImport({
      actorId: settings.actorId,
      providerUserId,
      workoutId,
      summaryId,
      summaryUpdatedAt
    })
    acceptedImportId = record.id
    if (record.hadStatus && !record.statusId) {
      return apiResponse({ req, allowedMethods: [], data: { success: true } })
    }

    const isNewer =
      record.summaryId !== summaryId ||
      (summaryUpdatedAt !== undefined &&
        (record.summaryUpdatedAt === undefined ||
          summaryUpdatedAt > record.summaryUpdatedAt))

    const isExisting =
      record.created === false ||
      (record.created === undefined &&
        (record.status === 'running' || record.status === 'completed'))

    if (isExisting) {
      if (record.status === 'pending' || record.status === 'running') {
        if (isNewer) {
          await database.updateWahooImport(record.id, {
            summaryId,
            summaryUpdatedAt
          })
        }
        return apiResponse({ req, allowedMethods: [], data: { success: true } })
      }

      if (record.status === 'completed') {
        // A completed record is a tombstone too: local deletion must never be
        // undone by a delayed or duplicate Wahoo webhook.
        if (!isNewer) {
          return apiResponse({
            req,
            allowedMethods: [],
            data: { success: true }
          })
        }
        await database.updateWahooImport(record.id, {
          status: 'pending',
          summaryId,
          summaryUpdatedAt
        })
      } else if (
        record.status === 'failed' ||
        record.status === 'unsupported'
      ) {
        await database.updateWahooImport(record.id, {
          status: 'pending',
          ...(isNewer ? { summaryId, summaryUpdatedAt } : {})
        })
      }
    }
    await queue.publish({
      id: crypto.randomUUID(),
      name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
      data: {
        importId: record.id,
        notifyOnComplete: true,
        ignoreHistoryCancellation: true
      }
    })
    return apiResponse({ req, allowedMethods: [], data: { success: true } })
  } catch (error) {
    if (acceptedImportId) {
      await database.markWahooImportFailed(
        acceptedImportId,
        'failed',
        'Failed to queue Wahoo import. Retry from settings.'
      )
    }
    logger.error({
      message: 'Failed to accept Wahoo webhook',
      actorId: settings.actorId,
      workoutId,
      err: toLoggableError(error)
    })
    return apiResponse({
      req,
      allowedMethods: [],
      data: { error: 'Webhook acceptance failed' },
      responseStatusCode: 503
    })
  }
})
