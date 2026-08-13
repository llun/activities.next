import { toGearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'
import { CreateGearComponentRequest } from '@/lib/services/fitness-gears/gearRequests'
import { rejectComponentsForDevice } from '@/lib/services/fitness-gears/gearRouteGuards'
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

export const GET = traceApiRoute(
  'listFitnessGearComponents',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id } = (await params) ?? { id: undefined }
    if (!id) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    const rejection = await rejectComponentsForDevice({
      req,
      database,
      actorId: currentActor.id,
      gearId: id
    })
    if (rejection) return rejection

    const components = await database.getFitnessGearComponents({
      gearId: id,
      actorId: currentActor.id
    })
    // Every component's install-window total in one grouped query.
    const rollups = await database.getFitnessGearComponentDistanceRollups({
      actorId: currentActor.id,
      gearIds: [id]
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        components: components.map((component) =>
          toGearComponentEntity(component, rollups[component.id])
        )
      },
      responseStatusCode: 200
    })
  })
)

export const POST = traceApiRoute(
  'createFitnessGearComponent',
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

    const parsed = CreateGearComponentRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const rejection = await rejectComponentsForDevice({
      req,
      database,
      actorId: currentActor.id,
      gearId: id
    })
    if (rejection) return rejection

    const component = await database.createFitnessGearComponent({
      gearId: id,
      actorId: currentActor.id,
      componentType: parsed.data.componentType,
      brand: parsed.data.brand,
      model: parsed.data.model,
      addedAt: parsed.data.addedAt ? new Date(parsed.data.addedAt) : null,
      removedAt: parsed.data.removedAt ? new Date(parsed.data.removedAt) : null,
      serviceDistanceMeters: parsed.data.serviceDistanceMeters
    })
    if (!component) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    return apiResponse({
      req,
      allowedMethods: [],
      data: { component: toGearComponentEntity(component) },
      responseStatusCode: 200
    })
  })
)
