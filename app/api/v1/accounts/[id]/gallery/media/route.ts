import { z } from 'zod'

import { isOwnerGalleryAudience } from '@/lib/services/gallery/galleryAudience'
import { getGalleryMediaPage } from '@/lib/services/gallery/galleryQueries'
import { resolveGalleryAccount } from '@/lib/services/gallery/resolveGalleryAccount'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import {
  GALLERY_SHOWS,
  MEDIA_SUBJECT_CATEGORIES
} from '@/lib/types/database/gallery'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
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

const GalleryMediaQueryParams = z.object({
  max_id: z.string().regex(/^\d+$/).max(10).optional(),
  limit: clampedLimit(60, 30),
  subject: z.string().trim().min(1).max(520).optional(),
  category: z.enum(MEDIA_SUBJECT_CATEGORIES).optional(),
  gear_id: z.string().max(255).optional(),
  // Owner only: `in_gallery` (default), `all` posted media or the `hidden` ones.
  // Anyone else is always shown the gallery, whatever they send.
  show: z.enum(GALLERY_SHOWS).optional()
})

// GET /api/v1/accounts/:id/gallery/media — a page of the account's gallery
// photos, newest upload first, as the requesting viewer may see them. Who the
// viewer is decides both which posts the photos may come from and how much of
// each photo (place, gear) is disclosed; the service owns both. `show` widens
// the list to posted media outside the gallery for the owner alone.
export const GET = traceApiRoute(
  'getAccountGalleryMedia',
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

      const parsed = GalleryMediaQueryParams.safeParse(
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

      const {
        max_id: maxId,
        limit,
        subject,
        category,
        gear_id: gearId,
        show
      } = parsed.data

      // Gear ids are the owner's own bookkeeping; no one else may filter by one.
      if (gearId !== undefined && !isOwnerGalleryAudience(audience)) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'gear_id is only available to the owner' },
          responseStatusCode: 422
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getGalleryMediaPage({
          database,
          owner,
          audience,
          maxId,
          limit,
          subjectKey: subject,
          category,
          gearId,
          // The service reads it for the owner audience only.
          show
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
