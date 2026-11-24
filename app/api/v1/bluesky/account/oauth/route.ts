import { z } from 'zod'

import { startBlueskyOAuth } from '@/lib/services/bluesky/account'
import { blueskyRouteResponse } from '@/lib/services/bluesky/routeResponse'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getServedAuthority } from '@/lib/utils/host'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const Body = z.object({ handle: z.string().min(1).max(253) })

// Starts Bluesky sign-in and answers the authorization URL to open.
export const POST = traceApiRoute(
  'startBlueskyOAuth',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return apiErrorResponse(400)
    return blueskyRouteResponse(req, ['POST'], async () => ({
      url: await startBlueskyOAuth(
        database,
        currentActor,
        parsed.data.handle,
        // The served host, falling back to the primary one for a proxy's
        // internal Host, like the metadata routes.
        getServedAuthority(headerHost(req.headers)) ?? undefined
      )
    }))
  })
)
