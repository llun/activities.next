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

const DEFAULT_LIMIT = 20
const MIN_LIMIT = 1
const MAX_LIMIT = 100

/**
 * A page of the activities attributed to one gear, newest first.
 *
 * Serves every kind: a bike or a pair of shoes match on `gearId`, a device on
 * `deviceGearId`, and the database method picks the column from the gear's own
 * kind so the caller never has to say which link it means.
 *
 * `hasMore` comes from fetching one row past the page rather than a second
 * COUNT query — the only thing the caller does with it is decide whether to
 * render "Load more", and a count of a history that can run to five figures is
 * a real cost for an answer nobody reads.
 */
export const GET = traceApiRoute(
  'listFitnessGearActivities',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id } = (await params) ?? { id: undefined }
    if (!id) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    // Ownership decides the 404: a stranger's gear id must not be
    // distinguishable from one that does not exist.
    const gear = await database.getFitnessGear({ id, actorId: currentActor.id })
    if (!gear) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    const url = new URL(req.url)
    // Clamped rather than rejected: a limit outside the range is a client bug,
    // not something worth failing a read over, and `Number.parseInt` of a
    // missing or unparsable value falls back to the default.
    const requestedLimit = Number.parseInt(
      url.searchParams.get('limit') ?? '',
      10
    )
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, requestedLimit))
      : DEFAULT_LIMIT
    const requestedOffset = Number.parseInt(
      url.searchParams.get('offset') ?? '',
      10
    )
    const offset =
      Number.isFinite(requestedOffset) && requestedOffset > 0
        ? requestedOffset
        : 0

    const rows = await database.getFitnessGearActivities({
      actorId: currentActor.id,
      gearId: gear.id,
      kind: gear.kind,
      limit: limit + 1,
      offset
    })
    const hasMore = rows.length > limit

    return apiResponse({
      req,
      allowedMethods: [],
      data: { activities: rows.slice(0, limit), hasMore },
      responseStatusCode: 200
    })
  })
)
