import { z } from 'zod'

import {
  getBlueskyAccountState,
  setBlueskyInstanceHandle
} from '@/lib/services/bluesky/account'
import { blueskyRouteResponse } from '@/lib/services/bluesky/routeResponse'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const Body = z.object({ enabled: z.boolean() })

export const POST = traceApiRoute(
  'setBlueskyInstanceHandle',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return apiErrorResponse(400)
    return blueskyRouteResponse(req, ['POST'], async () => {
      await setBlueskyInstanceHandle(
        database,
        currentActor,
        parsed.data.enabled
      )
      return getBlueskyAccountState(database, currentActor)
    })
  })
)
