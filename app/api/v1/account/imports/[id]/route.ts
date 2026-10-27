import { NextRequest } from 'next/server'

import type { Database } from '@/lib/database/types'
import { IMPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { getAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import { serializeAccountImport } from '@/lib/services/accountImport/serialize'
import { uploadAccountImport } from '@/lib/services/accountImport/upload'
import { isMovedActor } from '@/lib/services/accounts/movedAccount'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
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
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const METHODS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]
export const OPTIONS = defaultOptions(METHODS)

const respond = (
  req: NextRequest,
  data: unknown,
  status: StatusCode = HTTP_STATUS.OK
) =>
  apiResponse({
    req,
    allowedMethods: METHODS,
    data,
    responseStatusCode: status
  })

const error = (req: NextRequest, message: string, status: StatusCode) =>
  respond(req, { error: message }, status)

const hasActorMismatch = (req: NextRequest, actorId: string) => {
  const expected = new URL(req.url).searchParams.get('actorId')
  return expected !== null && expected !== actorId
}

interface Params {
  id: string
}

const ownedImport = async (
  req: NextRequest,
  context: {
    currentActor: { id: string; account?: { id: string } | null }
    database: Database
    params: Promise<Params>
  }
) => {
  const { id } = await context.params
  const accountId = context.currentActor.account?.id
  if (!accountId) {
    return {
      type: 'response' as const,
      response: error(req, 'Import not found', HTTP_STATUS.NOT_FOUND)
    }
  }
  const accountImport = await context.database.getAccountImport({
    id,
    actorId: context.currentActor.id
  })
  if (!accountImport || accountImport.accountId !== accountId) {
    return {
      type: 'response' as const,
      response: error(req, 'Import not found', HTTP_STATUS.NOT_FOUND)
    }
  }
  return { type: 'found' as const, accountImport }
}

export const GET = traceApiRoute(
  'getAccountImport',
  AuthenticatedGuard<Params>(async (req, context) => {
    const mismatch = expectedActorMismatchResponse(
      req,
      context.currentActor.id,
      METHODS
    )
    if (mismatch) return mismatch
    if (hasActorMismatch(req, context.currentActor.id)) {
      return error(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }
    const result = await ownedImport(req, context)
    if (result.type === 'response') return result.response
    return respond(req, serializeAccountImport(result.accountImport))
  })
)

export const POST = traceApiRoute(
  'uploadAccountImportById',
  AuthenticatedGuard<Params>(async (req, context) => {
    const mismatch = expectedActorMismatchResponse(
      req,
      context.currentActor.id,
      METHODS
    )
    if (mismatch) return mismatch
    if (hasActorMismatch(req, context.currentActor.id)) {
      return error(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }
    if (isMovedActor(context.currentActor)) {
      return error(
        req,
        'This account has moved',
        HTTP_STATUS.UNPROCESSABLE_ENTITY
      )
    }
    const result = await ownedImport(req, context)
    if (result.type === 'response') return result.response
    const { accountImport } = result
    if (accountImport.status !== 'queued') {
      return error(req, 'Import is not queued', HTTP_STATUS.CONFLICT)
    }
    const objectStore = getAccountImportObjectStore()
    if (!objectStore) {
      return error(
        req,
        'Import storage is unavailable',
        HTTP_STATUS.SERVICE_UNAVAILABLE
      )
    }
    const existingSize = await objectStore.store.size(
      objectStore.getUploadKey(accountImport)
    )
    if (existingSize !== null) {
      return error(req, 'Archive upload already exists', HTTP_STATUS.CONFLICT)
    }
    const contentLengthHeader = req.headers.get('content-length')
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : undefined
    const uploaded = await uploadAccountImport({
      database: context.database,
      objectStore,
      accountImport,
      body: req.body,
      ...(contentLength !== undefined && Number.isFinite(contentLength)
        ? { contentLength }
        : null)
    })
    if (uploaded.type === 'too-large') {
      return error(req, 'File is too large', HTTP_STATUS.PAYLOAD_TOO_LARGE)
    }
    if (uploaded.type === 'invalid') {
      return error(req, 'Invalid archive upload', HTTP_STATUS.BAD_REQUEST)
    }
    if (uploaded.type !== 'stored') {
      return error(
        req,
        'Could not store archive upload',
        HTTP_STATUS.SERVICE_UNAVAILABLE
      )
    }
    return respond(
      req,
      serializeAccountImport(accountImport),
      HTTP_STATUS.ACCEPTED
    )
  })
)

export const DELETE = traceApiRoute(
  'cancelAccountImport',
  AuthenticatedGuard<Params>(async (req, context) => {
    const mismatch = expectedActorMismatchResponse(
      req,
      context.currentActor.id,
      METHODS
    )
    if (mismatch) return mismatch
    if (hasActorMismatch(req, context.currentActor.id)) {
      return error(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }
    const result = await ownedImport(req, context)
    if (result.type === 'response') return result.response
    const { accountImport } = result
    const cancelled = await context.database.updateAccountImport({
      id: accountImport.id,
      onlyIfStatus: ['queued', 'running'],
      status: 'cancelled',
      finishedAt: Date.now()
    })
    if (!cancelled) {
      return error(req, 'Import is already finished', HTTP_STATUS.CONFLICT)
    }
    const queue = getQueue()
    void queue
      .publish({
        id: `${accountImport.id}:cancel`,
        name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
        data: { importId: accountImport.id, actorId: accountImport.actorId }
      })
      .catch((cause: unknown) => {
        logger.error({
          message: 'Failed to queue account archive import cancellation',
          importId: accountImport.id,
          err: toLoggableError(cause)
        })
      })
    return respond(
      req,
      serializeAccountImport({ ...accountImport, status: 'cancelled' }),
      HTTP_STATUS.ACCEPTED
    )
  })
)
