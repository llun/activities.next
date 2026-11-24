import { checkBlueskyHandle } from '@/lib/services/bluesky/account'
import { blueskyRouteResponse } from '@/lib/services/bluesky/routeResponse'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// Resolves the linked DID again, stores its current handle and PDS, and says
// whether the handle verifies and whether its DNS record is in place.
export const POST = traceApiRoute(
  'checkBlueskyHandle',
  AuthenticatedGuard(async (req, { currentActor, database }) =>
    blueskyRouteResponse(req, ['POST'], () =>
      checkBlueskyHandle(database, currentActor)
    )
  )
)
