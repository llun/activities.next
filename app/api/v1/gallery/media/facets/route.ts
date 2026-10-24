import { z } from 'zod'

import { getGalleryMediaFacets } from '@/lib/services/gallery/galleryMediaFacets'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { GALLERY_SHOWS } from '@/lib/types/database/gallery'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_422, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

const GalleryMediaFacetsQuery = z.object({
  show: z.enum(GALLERY_SHOWS).optional()
})

// GET /api/v1/gallery/media/facets — facets (species, places, months,
// activities, totals) for the caller's media.
export const GET = traceApiRoute(
  'getGalleryMediaFacets',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor }) => {
      const parsed = GalleryMediaFacetsQuery.safeParse(
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

      const data = await getGalleryMediaFacets({
        database,
        owner: currentActor,
        show: parsed.data.show
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data
      })
    },
    guardOptions
  )
)
