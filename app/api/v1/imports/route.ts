import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'

import { BULK_IMPORT_JOB_NAME } from '@/lib/jobs/names'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { parseImportCsv } from '@/lib/services/imports/parseImportCsv'
import { serializeBulkImport } from '@/lib/services/imports/serializeBulkImport'
import {
  BULK_IMPORT_FILE_SIZE_LIMIT,
  BULK_IMPORT_TYPES,
  BulkImportType
} from '@/lib/services/imports/types'
import { getQueue } from '@/lib/services/queue'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  StatusCode,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import {
  StreamByteLimitError,
  readUnknownBodyToBufferWithLimit
} from '@/lib/utils/streamLimit'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ALLOWED_METHODS: HttpMethod[] = ['GET', 'POST']

// Multipart boundaries and the other form fields
const MULTIPART_ALLOWANCE = 64 * 1024

export const OPTIONS = defaultOptions(ALLOWED_METHODS)

const errorResponse = (
  req: NextRequest,
  error: string,
  responseStatusCode: StatusCode = HTTP_STATUS.UNPROCESSABLE_ENTITY
) =>
  apiResponse({
    req,
    allowedMethods: ALLOWED_METHODS,
    data: { error },
    responseStatusCode
  })

export const POST = traceApiRoute(
  'createBulkImport',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const maxBodyBytes = BULK_IMPORT_FILE_SIZE_LIMIT + MULTIPART_ALLOWANCE
    const tooLarge = () =>
      errorResponse(req, 'File is too large', HTTP_STATUS.PAYLOAD_TOO_LARGE)

    // Fast path: refuse a declared size before reading anything.
    const contentLength = Number(req.headers.get('content-length') ?? 0)
    if (contentLength > maxBodyBytes) return tooLarge()

    // A chunked body has no content-length, so count the bytes as they arrive
    // and stop as soon as the cap is passed instead of buffering all of it.
    let bytes: Buffer
    try {
      bytes = req.body
        ? await readUnknownBodyToBufferWithLimit(
            req.body,
            maxBodyBytes,
            'Import request'
          )
        : Buffer.alloc(0)
    } catch (error) {
      if (error instanceof StreamByteLimitError) return tooLarge()
      return errorResponse(req, 'Invalid request', HTTP_STATUS.BAD_REQUEST)
    }

    let form: FormData
    try {
      form = await new Response(new Uint8Array(bytes), {
        headers: { 'content-type': req.headers.get('content-type') ?? '' }
      }).formData()
    } catch {
      return errorResponse(req, 'Invalid request', HTTP_STATUS.BAD_REQUEST)
    }

    const formActorId = form.get('actorId')
    const queryActorId = new URL(req.url).searchParams.get('actorId')
    if (
      (typeof formActorId === 'string' && formActorId !== currentActor.id) ||
      (queryActorId !== null && queryActorId !== currentActor.id)
    ) {
      return errorResponse(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }

    const rawType = form.get('type')
    if (
      !rawType ||
      typeof rawType !== 'string' ||
      !BULK_IMPORT_TYPES.includes(rawType as BulkImportType)
    ) {
      return errorResponse(req, 'Invalid import type')
    }
    const type = rawType as BulkImportType

    const rawMode = form.get('mode')
    const mode = rawMode === null || rawMode === '' ? 'merge' : rawMode
    if (mode !== 'merge' && mode !== 'overwrite') {
      return errorResponse(req, 'Invalid import mode')
    }

    const file = form.get('file')
    if (!file || !(file instanceof File)) {
      return errorResponse(req, 'File is required')
    }

    // Same answer as a body over the cap: the file can fit inside the
    // multipart allowance and still be over the limit.
    if (file.size > BULK_IMPORT_FILE_SIZE_LIMIT) return tooLarge()

    const text = await file.text()
    const parsed = parseImportCsv({ type, text })
    if (!parsed.ok) {
      return errorResponse(req, parsed.error)
    }

    const importId = randomUUID()
    const originalFilename = (file.name?.trim() || 'import.csv').slice(0, 255)

    const bulkImport = await database.createBulkImport({
      id: importId,
      actorId: currentActor.id,
      type,
      overwrite: mode === 'overwrite',
      originalFilename,
      rows: parsed.rows
    })

    if (!bulkImport) {
      return errorResponse(
        req,
        'An import is already in progress',
        HTTP_STATUS.CONFLICT
      )
    }

    const queue = getQueue()
    const message = {
      id: `${importId}:start`,
      name: BULK_IMPORT_JOB_NAME,
      data: { importId }
    }
    if (queue.runsInline) {
      // `publish` runs the whole job here (NoQueue), so awaiting it would hold
      // the request for the import and turn a job error into a failed start.
      // The job logs its own failures and keeps the import's state.
      void queue.publish(message).catch((error) => {
        logger.error({
          message: 'Inline bulk import run failed',
          importId,
          actorId: currentActor.id,
          err: toLoggableError(error)
        })
      })
    } else {
      try {
        await queue.publish(message)
      } catch (error) {
        // Finish the import so it does not block the actor's next import forever.
        logger.error({
          message: 'Failed to publish bulk import job',
          importId,
          actorId: currentActor.id,
          err: toLoggableError(error)
        })
        await database.updateBulkImport({
          id: importId,
          state: 'finished',
          finishedAt: Date.now(),
          lastError: 'Could not start the import'
        })
        return errorResponse(
          req,
          'Could not start the import, try again later',
          HTTP_STATUS.SERVICE_UNAVAILABLE
        )
      }
    }

    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: serializeBulkImport(bulkImport),
      responseStatusCode: HTTP_STATUS.ACCEPTED
    })
  })
)

export const GET = traceApiRoute(
  'getBulkImports',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const actorIdParam = new URL(req.url).searchParams.get('actorId')
    if (actorIdParam !== null && actorIdParam !== currentActor.id) {
      return errorResponse(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }

    const imports = await database.getBulkImports({
      actorId: currentActor.id,
      limit: 20
    })

    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: imports.map((item) => serializeBulkImport(item))
    })
  })
)
