import { toGalleryGearEntity } from '@/lib/services/gallery/galleryEntities'
import { RetireGalleryGearRequest } from '@/lib/services/gallery/galleryRequests'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

/**
 * Retiring and unretiring are one idempotent toggle, as for Fitness gear:
 * `{ retired: false }` reads as clearly as a separate `/unretire` route. A
 * retired camera or lens leaves the media-details pickers; it is not deleted.
 */
export const POST = traceApiRoute(
  'retireGalleryGear',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id } = (await params) ?? { id: undefined }
    if (!id) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    let body: unknown
    try {
      body = await req.json()
    } catch (_error) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = RetireGalleryGearRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const gear = await database.setGalleryGearRetired({
      id,
      actorId: currentActor.id,
      retired: parsed.data.retired
    })
    if (!gear) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    return apiResponse({
      req,
      allowedMethods: [],
      data: { gear: toGalleryGearEntity(gear) },
      responseStatusCode: 200
    })
  })
)
