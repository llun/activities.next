import { NextRequest } from 'next/server'

import { getAccountImportConfig } from '@/lib/config/accountImport'
import { getAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import { createQueuedAccountImport } from '@/lib/services/accountImport/request'
import { serializeAccountImport } from '@/lib/services/accountImport/serialize'
import { uploadAccountImport } from '@/lib/services/accountImport/upload'
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

const METHODS: HttpMethod[] = ['GET', 'POST']
const CORS_METHODS = [HttpMethod.enum.OPTIONS, ...METHODS]
export const OPTIONS = defaultOptions(CORS_METHODS)

const respond = (
  req: NextRequest,
  data: unknown,
  responseStatusCode: StatusCode = HTTP_STATUS.OK,
  additionalHeaders?: [string, string][]
) =>
  apiResponse({
    req,
    allowedMethods: CORS_METHODS,
    data,
    responseStatusCode,
    ...(additionalHeaders ? { additionalHeaders } : null)
  })

const error = (req: NextRequest, message: string, status: StatusCode) =>
  respond(req, { error: message }, status)

const actorIdMismatch = (req: NextRequest, actorId: string) => {
  const expected = new URL(req.url).searchParams.get('actorId')
  return expected && expected !== actorId
}

export const GET = traceApiRoute(
  'listAccountImports',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const mismatch = expectedActorMismatchResponse(
      req,
      currentActor.id,
      CORS_METHODS
    )
    if (mismatch) return mismatch
    if (actorIdMismatch(req, currentActor.id)) {
      return error(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }
    const accountId = currentActor.account?.id
    if (!accountId)
      return error(req, 'Account not found', HTTP_STATUS.NOT_FOUND)
    const imports = await database.listAccountImports({
      actorId: currentActor.id,
      limit: 20
    })
    return respond(
      req,
      imports
        .filter((accountImport) => accountImport.accountId === accountId)
        .map(serializeAccountImport)
    )
  })
)

export const POST = traceApiRoute(
  'uploadAccountImport',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const mismatch = expectedActorMismatchResponse(
      req,
      currentActor.id,
      CORS_METHODS
    )
    if (mismatch) return mismatch
    if (actorIdMismatch(req, currentActor.id)) {
      return error(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }
    if (isMovedActor(currentActor)) {
      return error(
        req,
        'This account has moved',
        HTTP_STATUS.UNPROCESSABLE_ENTITY
      )
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
    const contentLengthHeader = req.headers.get('content-length')
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : undefined
    if (
      contentLength !== undefined &&
      Number.isFinite(contentLength) &&
      contentLength > getAccountImportConfig().maxFileSize
    ) {
      return error(req, 'File is too large', HTTP_STATUS.PAYLOAD_TOO_LARGE)
    }

    const created = await createQueuedAccountImport({
      database,
      actorId: currentActor.id,
      accountId
    })
    if (created.type === 'active') {
      return error(req, 'An import is already active', HTTP_STATUS.CONFLICT)
    }
    const uploaded = await uploadAccountImport({
      database,
      objectStore,
      accountImport: created.accountImport,
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
      serializeAccountImport(created.accountImport),
      HTTP_STATUS.ACCEPTED
    )
  })
)
