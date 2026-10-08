import { z } from 'zod'

import { getGalleryLookupAvailability } from '@/lib/services/gallery/galleryLookupAvailability'
import { createGbifClient } from '@/lib/services/gallery/lookups/gbif'
import { createWindowCounter } from '@/lib/services/gallery/lookups/rateLimit'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// 60 searches per actor per minute: the picker searches as you type.
const SEARCHES_PER_MINUTE = 60
const ONE_MINUTE_MS = 60 * 1000
const searches = createWindowCounter({
  limit: SEARCHES_PER_MINUTE,
  windowMs: ONE_MINUTE_MS
})

const TaxaQuery = z.object({
  q: z.string().trim().min(2).max(100)
})

// GET /api/v1/gallery/taxa?q= — the species picker's search: up to 10 accepted
// species from the GBIF backbone whose scientific or common name matches. The
// owner's own session only; nothing here is public.
export const GET = traceApiRoute(
  'searchGalleryTaxa',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const query = TaxaQuery.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    )
    if (!query.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const { speciesLookupsAvailable } =
      await getGalleryLookupAvailability(database)
    if (!speciesLookupsAvailable) {
      return apiErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE)
    }

    if (!searches.tryHit(currentActor.id)) {
      return apiErrorResponse(HTTP_STATUS.TOO_MANY_REQUESTS)
    }

    try {
      const results = await createGbifClient({ database }).searchTaxa(
        query.data.q
      )
      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          taxa: results.map((taxon) => ({
            taxonKey: taxon.taxonKey,
            scientificName: taxon.scientificName,
            vernacularName: taxon.vernacularName,
            rank: taxon.rank,
            category: taxon.category,
            taxonPath: taxon.taxonPath
          }))
        },
        responseStatusCode: 200
      })
    } catch (error) {
      logger.warn({
        message: 'Failed to search GBIF taxa',
        err: toLoggableError(error)
      })
      return apiErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE)
    }
  })
)
