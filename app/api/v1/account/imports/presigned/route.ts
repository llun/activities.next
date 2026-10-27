import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getAccountImportConfig } from '@/lib/config/accountImport'
import { ACCOUNT_IMPORT_PRESIGNED_URL_TTL_SECONDS } from '@/lib/services/accountImport/constants'
import { getAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import { createQueuedAccountImport } from '@/lib/services/accountImport/request'
import { serializeAccountImport } from '@/lib/services/accountImport/serialize'
import { isMovedActor } from '@/lib/services/accounts/movedAccount'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { expectedActorMismatchResponse } from '@/lib/services/statuses/expectedActorMismatch'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  StatusCode,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const METHODS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
export const OPTIONS = defaultOptions(METHODS)
const RequestBody = z.object({ actorId: z.string().optional() }).strip()

const error = (req: NextRequest, message: string, status: StatusCode) =>
  apiResponse({
    req,
    allowedMethods: METHODS,
    data: { error: message },
    responseStatusCode: status
  })

export const POST = traceApiRoute(
  'presignAccountImportUpload',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const mismatch = expectedActorMismatchResponse(
      req,
      currentActor.id,
      METHODS
    )
    if (mismatch) return mismatch
    const queryActorId = new URL(req.url).searchParams.get('actorId')
    if (
      (queryActorId !== null && queryActorId !== currentActor.id) ||
      isMovedActor(currentActor)
    ) {
      return error(
        req,
        isMovedActor(currentActor) ? 'This account has moved' : 'Actor changed',
        isMovedActor(currentActor)
          ? HTTP_STATUS.UNPROCESSABLE_ENTITY
          : HTTP_STATUS.CONFLICT
      )
    }
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return error(req, 'Invalid request', HTTP_STATUS.BAD_REQUEST)
    }
    const parsed = RequestBody.safeParse(body)
    if (!parsed.success) {
      return error(req, 'Invalid request', HTTP_STATUS.BAD_REQUEST)
    }
    if (parsed.data.actorId && parsed.data.actorId !== currentActor.id) {
      return error(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }
    const accountId = currentActor.account?.id
    if (!accountId)
      return error(req, 'Account not found', HTTP_STATUS.NOT_FOUND)
    const objectStore = getAccountImportObjectStore()
    if (!objectStore) {
      return error(
        req,
        'Import storage is unavailable',
        HTTP_STATUS.SERVICE_UNAVAILABLE
      )
    }
    const created = await createQueuedAccountImport({
      database,
      actorId: currentActor.id,
      accountId
    })
    if (created.type === 'active') {
      return error(req, 'An import is already active', HTTP_STATUS.CONFLICT)
    }

    try {
      const uploadUrl = await objectStore.store.getUploadUrl(
        objectStore.getUploadKey(created.accountImport),
        getAccountImportConfig().maxFileSize,
        ACCOUNT_IMPORT_PRESIGNED_URL_TTL_SECONDS
      )
      return apiResponse({
        req,
        allowedMethods: METHODS,
        data: {
          ...serializeAccountImport(created.accountImport),
          uploadUrl,
          directUploadPath: uploadUrl
            ? null
            : `/api/v1/account/imports/${created.accountImport.id}`
        },
        responseStatusCode: HTTP_STATUS.ACCEPTED
      })
    } catch {
      await database.updateAccountImport({
        id: created.accountImport.id,
        onlyIfStatus: ['queued'],
        status: 'failed',
        lastErrorCode: 'upload_url_failed',
        finishedAt: Date.now()
      })
      await objectStore
        .deleteUpload(created.accountImport)
        .catch(() => undefined)
      return error(
        req,
        'Could not prepare archive upload',
        HTTP_STATUS.SERVICE_UNAVAILABLE
      )
    }
  })
)
