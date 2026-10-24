import { NextRequest } from 'next/server'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { serializeBulkImport } from '@/lib/services/imports/serializeBulkImport'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  StatusCode,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ALLOWED_METHODS: HttpMethod[] = ['GET']

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

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getBulkImport',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id } = await params

    const actorIdParam = new URL(req.url).searchParams.get('actorId')
    if (actorIdParam !== null && actorIdParam !== currentActor.id) {
      return errorResponse(req, 'Actor changed', HTTP_STATUS.CONFLICT)
    }

    const bulkImport = await database.getBulkImport({
      id,
      actorId: currentActor.id
    })

    if (!bulkImport) {
      return errorResponse(req, 'Record not found', HTTP_STATUS.NOT_FOUND)
    }

    const failedRows = await database.getBulkImportFailedRows({
      importId: id,
      limit: 100
    })

    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: serializeBulkImport(bulkImport, failedRows)
    })
  })
)
