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
import { ERROR_422, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

// GET /api/v1/bookmark_folders — the signed-in actor's private bookmark
// folders, by name case-insensitively. Owner only, never federated.
export const GET = traceApiRoute(
  'listBookmarkFolders',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:bookmarks']],
    async (req, { database, currentActor }) => {
      const folders = await database.getBookmarkFolders({
        actorId: currentActor.id
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: folders.map(toBookmarkFolderEntity)
      })
    },
    guardOptions
  )
)

// POST /api/v1/bookmark_folders — creates a folder from `{ name }`. 422 for a
// blank or too long name, one already used (case-insensitively), or past the
// folder cap.
export const POST = traceApiRoute(
  'createBookmarkFolder',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:bookmarks']],
    async (req, { database, currentActor }) => {
      const parsed = BookmarkFolderRequest.safeParse(
        await req.json().catch(() => undefined)
      )
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }
      const result = await database.createBookmarkFolder({
        actorId: currentActor.id,
        name: parsed.data.name
      })
      if (result.status !== 'ok') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            error:
              result.status === 'not-found'
                ? ERROR_422.error
                : BOOKMARK_FOLDER_WRITE_ERRORS[result.status]
          },
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
