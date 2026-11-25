import { z } from 'zod'

import {
  getBlueskyAccountState,
  unlinkBluesky,
  updateBlueskyCrosspostDefault
} from '@/lib/services/bluesky/account'
import { blueskyRouteResponse } from '@/lib/services/bluesky/routeResponse'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import type { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const METHODS: HttpMethod[] = ['GET', 'PATCH', 'DELETE']

const PatchBody = z.object({ crosspostByDefault: z.boolean() })

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

// Settings › Other networks "Post to Bluesky by default".
export const PATCH = traceApiRoute(
  'updateBlueskyAccount',
  // Session only, like the rest of this Settings route.
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const parsed = PatchBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return apiCorsError(req, METHODS, 400)
    return blueskyRouteResponse(req, METHODS, async () => {
      await updateBlueskyCrosspostDefault(
        database,
        currentActor,
        parsed.data.crosspostByDefault
      )
      return getBlueskyAccountState(database, currentActor)
    })
  })
)
