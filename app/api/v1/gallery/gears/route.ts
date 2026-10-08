import { z } from 'zod'

import { toGalleryGearEntity } from '@/lib/services/gallery/galleryEntities'
import { getGalleryGearUsage } from '@/lib/services/gallery/galleryGearUsage'
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

const ListQuery = z.object({ include: z.enum(['usage']).optional() })

// The actor's camera and lens gear. Edit, retire and delete are on `[id]`;
// uploads create rows here on their own, keyed on the EXIF identity, via
// `resolveGalleryGear`. `?include=usage` adds each gear's photo count and the
// first and last time it was used, from one read of the actor's media.
export const GET = traceApiRoute(
  'listGalleryGears',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const query = ListQuery.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    )
    if (!query.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const gears = await database.getGalleryGearsByActor({
      actorId: currentActor.id
    })

    if (query.data.include === 'usage') {
      const usage = await getGalleryGearUsage({
        database,
        actorId: currentActor.id,
        gearIds: gears.map((gear) => gear.id)
      })
      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          gears: gears.map((gear) => ({
            ...toGalleryGearEntity(gear),
            ...usage.get(gear.id)
          }))
        },
        responseStatusCode: 200
      })
    }

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
