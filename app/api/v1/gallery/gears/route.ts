import { toGalleryGearEntity } from '@/lib/services/gallery/galleryEntities'
import {
  CreateGalleryGearRequest,
  MAX_GALLERY_GEAR_PER_ACTOR
} from '@/lib/services/gallery/galleryRequests'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// The actor's camera and lens gear. Full CRUD (edit, retire, delete) arrives
// with the gallery's Gear section; uploads create rows here on their own, keyed
// on the EXIF identity, via `resolveGalleryGear`.
export const GET = traceApiRoute(
  'listGalleryGears',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const gears = await database.getGalleryGearsByActor({
      actorId: currentActor.id
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: { gears: gears.map(toGalleryGearEntity) },
      responseStatusCode: 200
    })
  })
)

export const POST = traceApiRoute(
  'createGalleryGear',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    let body: unknown
    try {
      body = await req.json()
    } catch (_error) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = CreateGalleryGearRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    // The duplicate check, the cap and the insert run in one transaction
    // serialised on the actor row, so a double-submit or a retry while the
    // first request is still in flight hands back the row already there
    // instead of adding a twin, and concurrent creates cannot overshoot the
    // cap. `gallery_gears` has no name index to enforce this: manual gear has
    // no `deviceKey`, the one column it is unique on.
    const result = await database.createGalleryGearWithinLimit({
      actorId: currentActor.id,
      kind: parsed.data.kind,
      name: parsed.data.name,
      brand: parsed.data.brand,
      model: parsed.data.model,
      productUrl: parsed.data.productUrl,
      limit: MAX_GALLERY_GEAR_PER_ACTOR,
      dedupeByName: true
    })

    if (result.status === 'limit-reached') {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Too many gear items' },
        responseStatusCode: 422
      })
    }
    const { gear } = result

    return apiResponse({
      req,
      allowedMethods: [],
      data: { gear: toGalleryGearEntity(gear) },
      responseStatusCode: 200
    })
  })
)
