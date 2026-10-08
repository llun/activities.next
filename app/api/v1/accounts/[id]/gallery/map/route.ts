import { z } from 'zod'

import {
  PUBLIC_GALLERY_AUDIENCE,
  isOwnerGalleryAudience
} from '@/lib/services/gallery/galleryAudience'
import { getGalleryMapPoints } from '@/lib/services/gallery/galleryQueries'
import { resolveGalleryAccount } from '@/lib/services/gallery/resolveGalleryAccount'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const GalleryMapQueryParams = z.object({
  preview: z.enum(['public']).optional()
})

// GET /api/v1/accounts/:id/gallery/map — the account's located photos. Anyone
// but the owner gets a 404 unless the owner made the map public, and then only
// the area and exact points outside the hidden locations. The owner's
// `preview=public` runs the real logged-out query, not the owner rows
// re-projected, so the preview is exactly what the public gets. No bounding-box
// or proximity filter is accepted: it would have to filter on the disclosed
// coordinates, never the stored ones.
export const GET = traceApiRoute(
  'getAccountGalleryMap',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context

      const { id: encodedAccountId } = await params
      if (!encodedAccountId) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const resolved = await resolveGalleryAccount({
        database,
        encodedAccountId,
        currentActor
      })
      if (!resolved) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      const { owner, audience } = resolved

      const parsed = GalleryMapQueryParams.safeParse(
        Object.fromEntries(new URL(req.url).searchParams.entries())
      )
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const isOwner = isOwnerGalleryAudience(audience)
      if (!isOwner) {
        const settings = await database.getGallerySettings({
          actorId: owner.id
        })
        if (!settings.mapPublic) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getGalleryMapPoints({
          database,
          owner,
          audience:
            isOwner && parsed.data.preview === 'public'
              ? PUBLIC_GALLERY_AUDIENCE
              : audience
        })
      })
    },
    // `matchMode: 'any'` because a token may legally hold `read:statuses`
    // alone, and `errorResponse` so the guard's own rejections carry CORS
    // headers (see the sibling account media route).
    {
      errorResponse: corsErrorResponse(CORS_HEADERS),
      matchMode: 'any'
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
