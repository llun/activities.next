import { toGalleryGearEntity } from '@/lib/services/gallery/galleryEntities'
import { getGalleryGearUsage } from '@/lib/services/gallery/galleryGearUsage'
import { UpdateGalleryGearRequest } from '@/lib/services/gallery/galleryRequests'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  DEFAULT_200,
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

// The owner's single camera or lens. Every method is scoped to the signed-in
// actor, so a missing id and somebody else's id are both a 404.

export const GET = traceApiRoute(
  'getGalleryGear',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id } = (await params) ?? { id: undefined }
    if (!id) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    const gear = await database.getGalleryGear({
      id,
      actorId: currentActor.id
    })
    if (!gear) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    const usage = await getGalleryGearUsage({
      database,
      actorId: currentActor.id,
      gearIds: [gear.id]
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: { gear: { ...toGalleryGearEntity(gear), ...usage.get(gear.id) } },
      responseStatusCode: 200
    })
  })
)

export const PATCH = traceApiRoute(
  'updateGalleryGear',
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

    const parsed = UpdateGalleryGearRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const gear = await database.updateGalleryGear({
      id,
      actorId: currentActor.id,
      ...parsed.data
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

export const DELETE = traceApiRoute(
  'deleteGalleryGear',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id } = (await params) ?? { id: undefined }
    if (!id) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    const deleted = await database.deleteGalleryGear({
      id,
      actorId: currentActor.id
    })
    if (!deleted) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    return apiResponse({
      req,
      allowedMethods: [],
      data: DEFAULT_200,
      responseStatusCode: 200
    })
  })
)
