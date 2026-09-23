import { z } from 'zod'

import { IMPORT_WAHOO_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const RetrySchema = z.object({ importId: z.string().uuid() })

export const GET = traceApiRoute(
  'getWahooFailedImports',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const imports = await database.getWahooImportsByActor({
      actorId: currentActor.id,
      statuses: ['failed', 'unsupported'],
      limit: 25
    })
    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        imports: imports.map((item) => ({
          id: item.id,
          workoutId: item.workoutId,
          status: item.status,
          lastError: item.lastError
        }))
      }
    })
  })
)

export const POST = traceApiRoute(
  'retryWahooFailedImport',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    if (getQueue().runsInline) return apiErrorResponse(503)
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(400)
    }
    const parsed = RetrySchema.safeParse(body)
    if (!parsed.success) return apiErrorResponse(422)
    const record = await database.getWahooImport(parsed.data.importId)
    const settings = await database.getFitnessSettings({
      actorId: currentActor.id,
      serviceType: 'wahoo'
    })
    if (
      !record ||
      record.actorId !== currentActor.id ||
      !['failed', 'unsupported'].includes(record.status) ||
      !settings?.accessToken ||
      settings.providerUserId !== record.providerUserId
    )
      return apiErrorResponse(409)

    if (!(await database.markWahooImportPending(record.id))) {
      return apiErrorResponse(409)
    }
    try {
      await getQueue().publish({
        id: crypto.randomUUID(),
        name: IMPORT_WAHOO_ACTIVITY_JOB_NAME,
        data: {
          importId: record.id,
          notifyOnComplete: !record.historyImportId,
          ignoreHistoryCancellation: true
        }
      })
    } catch {
      await database.markWahooImportFailed(
        record.id,
        'failed',
        'Failed to queue Wahoo activity. Retry from settings.'
      )
      return apiErrorResponse(503)
    }
    return apiResponse({ req, allowedMethods: [], data: { success: true } })
  })
)
