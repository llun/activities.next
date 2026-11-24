import {
  getBlueskyAccountState,
  unlinkBluesky
} from '@/lib/services/bluesky/account'
import { blueskyRouteResponse } from '@/lib/services/bluesky/routeResponse'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import type { HttpMethod } from '@/lib/utils/http-headers'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const METHODS: HttpMethod[] = ['GET', 'DELETE']

export const GET = traceApiRoute(
  'getBlueskyAccount',
  AuthenticatedGuard(async (req, { currentActor, database }) =>
    blueskyRouteResponse(req, METHODS, () =>
      getBlueskyAccountState(database, currentActor)
    )
  )
)

export const DELETE = traceApiRoute(
  'unlinkBlueskyAccount',
  AuthenticatedGuard(async (req, { currentActor, database }) =>
    blueskyRouteResponse(req, METHODS, async () => {
      await unlinkBluesky(database, currentActor)
      return getBlueskyAccountState(database, currentActor)
    })
  )
)
