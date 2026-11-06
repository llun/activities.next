import type { NextRequest } from 'next/server'

import {
  BOOKMARK_FOLDER_WRITE_ERRORS,
  BookmarkFolderRequest,
  toBookmarkFolderEntity
} from '@/lib/services/bookmarks/bookmarkFolders'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  DEFAULT_200,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

// Every method is scoped to the signed-in actor, so a missing folder and
// somebody else's folder are the same 404.
const notFound = (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: ERROR_404,
    responseStatusCode: 404
  })

// PATCH /api/v1/bookmark_folders/:id — renames the folder from `{ name }`.
export const PATCH = traceApiRoute(
  'updateBookmarkFolder',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:bookmarks']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const parsed = BookmarkFolderRequest.safeParse(
        await req.json().catch(() => undefined)
      )
      if (!parsed.success) {
        // An unknown folder answers 404 whatever the body says.
        const folder = await database.getBookmarkFolder({
          id,
          actorId: currentActor.id
        })
        if (!folder) return notFound(req)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }
      const result = await database.updateBookmarkFolder({
        id,
        actorId: currentActor.id,
        name: parsed.data.name
      })
      if (result.status === 'not-found') return notFound(req)
      if (result.status !== 'ok') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: BOOKMARK_FOLDER_WRITE_ERRORS[result.status] },
          responseStatusCode: 422
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: toBookmarkFolderEntity(result.folder)
      })
    },
    guardOptions
  )
)

// DELETE /api/v1/bookmark_folders/:id — deletes the folder. Its bookmarks stay
// bookmarked, unfiled.
export const DELETE = traceApiRoute(
  'deleteBookmarkFolder',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:bookmarks']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const deleted = await database.deleteBookmarkFolder({
        id,
        actorId: currentActor.id
      })
      if (!deleted) return notFound(req)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: DEFAULT_200
      })
    },
    guardOptions
  )
)
