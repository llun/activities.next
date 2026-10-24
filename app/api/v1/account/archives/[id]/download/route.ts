import { Readable } from 'stream'

import { getArchiveDownloadFileName } from '@/lib/services/accountArchive/constants'
import { expireArchiveIfDue } from '@/lib/services/accountArchive/expiry'
import {
  assertArchiveKey,
  getArchiveObjectStore
} from '@/lib/services/accountArchive/objectStore'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  apiErrorResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

/**
 * A suspended account keeps access to its own data (an export is the user's
 * copy of it), so this route lets moderation-blocked accounts through.
 *
 * Owner only. Anyone else, an unknown id and an export that is not ready all
 * answer 404, so the id cannot be used to learn whose export exists.
 */
export const GET = traceApiRoute(
  'downloadAccountArchive',
  AuthenticatedGuard<Params>(
    async (_req, context) => {
      const { currentActor, database } = context
      const accountId = currentActor.account?.id
      if (!accountId) return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)

      const { id } = await context.params
      const found = await database.getAccountArchive({ id })
      if (!found || found.accountId !== accountId) {
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }
      const archive = await expireArchiveIfDue({ database, archive: found })
      if (archive.status === 'expired') {
        return apiErrorResponse(HTTP_STATUS.GONE)
      }
      if (archive.status !== 'ready' || !archive.storagePath) {
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      const store = getArchiveObjectStore()
      if (!store) return apiErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE)

      const fileName = getArchiveDownloadFileName(archive.id)
      const key = assertArchiveKey(archive.storagePath)

      const url = await store.getDownloadUrl(key, { fileName })
      if (url) {
        return new Response(null, {
          status: 302,
          headers: { Location: url, 'Cache-Control': 'no-store' }
        })
      }

      const stream = await store.openRead(key)
      if (!stream) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      const headers = new Headers({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      })
      const size = await store.size(key)
      if (size !== null) headers.set('Content-Length', String(size))
      return new Response(
        Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
        { status: 200, headers }
      )
    },
    { allowModerationBlocked: true }
  )
)
