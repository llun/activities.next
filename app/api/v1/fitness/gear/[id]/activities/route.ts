import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { cleanJson } from '@/lib/utils/cleanJson'
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
 * A page of the activities attributed to one gear, newest first, as the posts
 * they were published as — the same `Status` shape every timeline renders, so
 * a gear's Activities view and a device's page show the identical post with the
 * identical actions.
 *
 * Serves every kind: a bike or a pair of shoes match on `gearId`, a device on
 * `deviceGearId`, and the database method picks the column from the gear's own
 * kind so the caller never has to say which link it means.
 *
 * `hasMore` comes from fetching one row past the page rather than a second
 * COUNT query — the only thing the caller does with it is decide whether to
 * render "Load more", and a count of a history that can run to five figures is
 * a real cost for an answer nobody reads.
 *
 * `nextOffset` is what the caller pages from, and it counts ACTIVITY ROWS, not
 * the statuses returned. The two differ: an activity whose post was deleted
 * keeps its `fitness_files` row (status deletion only nulls `statusId`) and so
 * still counts toward the gear's totals, but has no post left to render. Paging
 * from `statuses.length` would re-request the rows in between on every page.
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
    const page = rows.slice(0, limit)

    // One batched read, in the activity order the rows came back in —
    // `getStatusesByIds` preserves the input order and drops the ids it cannot
    // find, which is also how a post deleted between the two queries leaves.
    // No `visibleToActorId`: every one of these is the caller's own post,
    // reached through their own `fitness_files` rows.
    const statusIds = page
      .map((activity) => activity.statusId)
      .filter((statusId): statusId is string => Boolean(statusId))
    const statuses = await database.getStatusesByIds({
      statusIds,
      currentActorId: currentActor.id,
      withReplies: false
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        statuses: statuses.map((status) => cleanJson(status)),
        hasMore,
        nextOffset: offset + page.length
      },
      responseStatusCode: 200
    })
  })
)
