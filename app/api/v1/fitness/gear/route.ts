import { toGearEntity } from '@/lib/services/fitness-gears/gearEntities'
import {
  CreateGearRequest,
  getGearKindFieldError
} from '@/lib/services/fitness-gears/gearRequests'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'listFitnessGear',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    const gears = await database.getFitnessGearsByActor({
      actorId: currentActor.id
    })
    // One grouped query for the whole page, not one per gear.
    const rollups = await database.getFitnessGearDistanceRollups({
      actorId: currentActor.id,
      gearIds: gears.map((gear) => gear.id)
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        gear: gears.map((gear) => toGearEntity(gear, rollups[gear.id]))
      },
      responseStatusCode: 200
    })
  })
)

export const POST = traceApiRoute(
  'createFitnessGear',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    let body: unknown
    try {
      body = await req.json()
    } catch (_error) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = CreateGearRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const fieldError = getGearKindFieldError(parsed.data.kind, parsed.data)
    if (fieldError) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: fieldError },
        responseStatusCode: 422
      })
    }

    const gear = await database.createFitnessGear({
      actorId: currentActor.id,
      kind: parsed.data.kind,
      name: parsed.data.name,
      brand: parsed.data.brand,
      model: parsed.data.model,
      bikeType: parsed.data.bikeType,
      weightKilograms: parsed.data.weightKilograms,
      defaultSports: parsed.data.defaultSports ?? [],
      alertDistanceMeters: parsed.data.alertDistanceMeters,
      notes: parsed.data.notes
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: { gear: toGearEntity(gear) },
      responseStatusCode: 200
    })
  })
)
