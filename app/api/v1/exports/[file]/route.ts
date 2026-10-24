import {
  exportAccountData,
  isExportFileName
} from '@/lib/services/exports/accountExports'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HTTP_STATUS, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  file: string
}

export const GET = traceApiRoute(
  'getAccountExport',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { file } = (await params) ?? { file: undefined }

    if (!file || !isExportFileName(file)) {
      return apiResponse({
        req,
        allowedMethods: ['GET'],
        data: { error: 'Record not found' },
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    }

    const actorIdParam = new URL(req.url).searchParams.get('actorId')
    if (actorIdParam !== null && actorIdParam !== currentActor.id) {
      return apiResponse({
        req,
        allowedMethods: ['GET'],
        data: { error: 'Actor changed' },
        responseStatusCode: HTTP_STATUS.CONFLICT
      })
    }

    const csv = await exportAccountData(file, database, currentActor.id)

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Cache-Control': 'no-store'
      }
    })
  })
)
