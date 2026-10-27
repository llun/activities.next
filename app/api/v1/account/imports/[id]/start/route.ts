import { NextRequest } from 'next/server'
import { z } from 'zod'

import { IMPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { toArchiveLoggableError } from '@/lib/services/accountArchive/redact'
import {
  ACCOUNT_IMPORT_MAX_STARTS,
  ACCOUNT_IMPORT_START_WINDOW_MS
} from '@/lib/services/accountImport/constants'
import { getAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import { accountImportOptionsSchema } from '@/lib/services/accountImport/phases'
import { serializeAccountImport } from '@/lib/services/accountImport/serialize'
import { startAccountImport } from '@/lib/services/accountImport/start'
import { isMovedActor } from '@/lib/services/accounts/movedAccount'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { isActorModerationBlocked } from '@/lib/services/guards/accountState'
import { getQueue } from '@/lib/services/queue'
import { expectedActorMismatchResponse } from '@/lib/services/statuses/expectedActorMismatch'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  StatusCode,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const METHODS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
export const OPTIONS = defaultOptions(METHODS)

const RequestBody = z
  .object({
    actorId: z.string().optional(),
    options: z.unknown().optional()
  })
  .strip()

const error = (
  req: NextRequest,
  message: string,
  status: StatusCode,
  headers?: [string, string][]
) =>
  apiResponse({
    req,
    allowedMethods: METHODS,
    data: { error: message },
    responseStatusCode: status,
    ...(headers ? { additionalHeaders: headers } : null)
  })

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'startAccountImport',
  AuthenticatedGuard<Params>(
    async (req, { currentActor, database, params }) => {
      const mismatch = expectedActorMismatchResponse(
        req,
        currentActor.id,
        METHODS
      )
      if (mismatch) return mismatch
      const queryActorId = new URL(req.url).searchParams.get('actorId')
      if (queryActorId !== null && queryActorId !== currentActor.id) {
        return error(req, 'Actor changed', HTTP_STATUS.CONFLICT)
      }
      const actor = await database.getActorFromId({ id: currentActor.id })
      if (!actor) {
        return error(req, 'Account not found', HTTP_STATUS.NOT_FOUND)
      }
      if (isMovedActor(actor)) {
        return error(
          req,
          'This account has moved',
          HTTP_STATUS.UNPROCESSABLE_ENTITY
        )
      }
      if (isActorModerationBlocked(actor)) {
        return error(req, 'This account is unavailable', HTTP_STATUS.FORBIDDEN)
      }
      if (actor.deletionStatus) {
        return error(
          req,
          'This account is being deleted',
          HTTP_STATUS.UNPROCESSABLE_ENTITY
        )
      }
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return error(req, 'Invalid request', HTTP_STATUS.BAD_REQUEST)
      }
      const parsed = RequestBody.safeParse(body)
      if (!parsed.success)
        return error(req, 'Invalid request', HTTP_STATUS.BAD_REQUEST)
      if (parsed.data.actorId && parsed.data.actorId !== currentActor.id) {
        return error(req, 'Actor changed', HTTP_STATUS.CONFLICT)
      }
      const options = accountImportOptionsSchema.safeParse(
        parsed.data.options ?? {}
      )
      if (!options.success) {
        return error(
          req,
          'Invalid import options',
          HTTP_STATUS.UNPROCESSABLE_ENTITY
        )
      }
      const accountId = currentActor.account?.id
      if (!accountId)
        return error(req, 'Account not found', HTTP_STATUS.NOT_FOUND)
      const { id } = await params
      const accountImport = await database.getAccountImport({
        id,
        actorId: currentActor.id
      })
      if (!accountImport || accountImport.accountId !== accountId) {
        return error(req, 'Import not found', HTTP_STATUS.NOT_FOUND)
      }
      const active = await database.getActiveAccountImport({
        actorId: currentActor.id
      })
      if (active && active.id !== id) {
        return error(req, 'An import is already active', HTTP_STATUS.CONFLICT)
      }

      // The limit is per ACCOUNT: every profile of the account shares the
      // three starts a 24 h window allows.
      const since = Date.now() - ACCOUNT_IMPORT_START_WINDOW_MS
      const recentStarts = await database.countAccountImportStartsSince({
        accountId,
        since
      })
      if (recentStarts >= ACCOUNT_IMPORT_MAX_STARTS) {
        const oldestStart = await database.getOldestAccountImportStartSince({
          accountId,
          since
        })
        const retryAfter = Math.max(
          1,
          Math.ceil(
            ((oldestStart ?? Date.now()) +
              ACCOUNT_IMPORT_START_WINDOW_MS -
              Date.now()) /
              1000
          )
        )
        return error(
          req,
          'Too many imports started recently',
          HTTP_STATUS.TOO_MANY_REQUESTS,
          [['Retry-After', String(retryAfter)]]
        )
      }

      const objectStore = getAccountImportObjectStore()
      const result = await startAccountImport({
        database,
        objectStore,
        accountImport,
        options: options.data
      })
      if (result.type !== 'started') {
        switch (result.type) {
          case 'not-found':
            return error(req, 'Import not found', HTTP_STATUS.NOT_FOUND)
          case 'not-queued':
            return error(req, 'Import is not queued', HTTP_STATUS.CONFLICT)
          case 'active':
            return error(
              req,
              'An import is already active',
              HTTP_STATUS.CONFLICT
            )
          case 'too-large':
            return error(
              req,
              'File is too large',
              HTTP_STATUS.PAYLOAD_TOO_LARGE
            )
          case 'archive-changed':
            return error(
              req,
              'Archive changed; upload it again',
              HTTP_STATUS.CONFLICT
            )
          case 'unrecognised':
            return error(
              req,
              'Archive format is not recognised',
              HTTP_STATUS.UNPROCESSABLE_ENTITY
            )
          default:
            return error(
              req,
              'Import storage is unavailable',
              HTTP_STATUS.SERVICE_UNAVAILABLE
            )
        }
      }

      const queue = getQueue()
      const message = {
        id: `${id}:start`,
        name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
        data: { importId: id, actorId: currentActor.id }
      }
      const failQueueing = async (cause: unknown) => {
        logger.error({
          message: 'Failed to queue an account archive import',
          importId: id,
          err: toArchiveLoggableError(cause)
        })
        await database.updateAccountImport({
          id,
          onlyIfStatus: ['running'],
          status: 'failed',
          lastErrorCode: 'queue_failed',
          finishedAt: Date.now()
        })
        if (objectStore) await objectStore.deleteUpload(result.accountImport)
      }
      if (queue.runsInline) {
        void queue.publish(message).catch(failQueueing)
      } else {
        try {
          await queue.publish(message)
        } catch (cause) {
          await failQueueing(cause)
          return error(
            req,
            'Could not start the import',
            HTTP_STATUS.SERVICE_UNAVAILABLE
          )
        }
      }
      return apiResponse({
        req,
        allowedMethods: METHODS,
        data: serializeAccountImport(result.accountImport),
        responseStatusCode: HTTP_STATUS.ACCEPTED
      })
    }
  )
)
