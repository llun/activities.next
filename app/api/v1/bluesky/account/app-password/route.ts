import { z } from 'zod'

import {
  getBlueskyAccountState,
  linkBlueskyAppPassword
} from '@/lib/services/bluesky/account'
import { blueskyRouteResponse } from '@/lib/services/bluesky/routeResponse'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const Body = z.object({
  identifier: z.string().min(1).max(253),
  password: z.string().min(1).max(64)
})

export const POST = traceApiRoute(
  'linkBlueskyAppPassword',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return apiErrorResponse(400)
    return blueskyRouteResponse(req, ['POST'], async () => {
      await linkBlueskyAppPassword(database, currentActor, parsed.data)
      return getBlueskyAccountState(database, currentActor)
    })
  })
)
