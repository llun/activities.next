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

const normalizeGearName = (name: string) =>
  name.trim().replace(/\s+/g, ' ').toLowerCase()

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

    const existingGears = await database.getGalleryGearsByActor({
      actorId: currentActor.id
    })

    // A double-submit (or a retry) of the same camera is the same camera: hand
    // back the row that is already there instead of adding a twin.
    const requestedName = normalizeGearName(parsed.data.name)
    const duplicate = existingGears.find(
      (existing) =>
        existing.kind === parsed.data.kind &&
        normalizeGearName(existing.name) === requestedName
    )
    if (duplicate) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { gear: toGalleryGearEntity(duplicate) },
        responseStatusCode: 200
      })
    }

    if (existingGears.length >= MAX_GALLERY_GEAR_PER_ACTOR) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Too many gear items' },
        responseStatusCode: 422
      })
    }

    const gear = await database.createGalleryGear({
      actorId: currentActor.id,
      kind: parsed.data.kind,
      name: parsed.data.name,
      brand: parsed.data.brand,
      model: parsed.data.model,
      productUrl: parsed.data.productUrl
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: { gear: toGalleryGearEntity(gear) },
      responseStatusCode: 200
    })
  })
)
