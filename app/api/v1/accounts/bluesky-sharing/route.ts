import { z } from 'zod'

import { blockActor } from '@/lib/actions/blockActor'
import { followActor } from '@/lib/actions/followActor'
import { unblockActor } from '@/lib/actions/unblockActor'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import {
  getBlueskySharingState,
  getStoredBlueskyBridge
} from '@/lib/services/blueskySharing'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { BLUESKY_BRIDGE_DOMAIN } from '@/lib/utils/accountHandle'
import {
  BLUESKY_BRIDGE_ACTOR_ID,
  getBlueskyRequirements
} from '@/lib/utils/blueskySharing'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const Request = z.object({ enabled: z.boolean() })

export const POST = traceApiRoute(
  'updateBlueskySharing',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    let body
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(400)
    }
    const parsed = Request.safeParse(body)
    if (!parsed.success) return apiErrorResponse(400)

    const errorResponse = (
      error: string,
      responseStatusCode: 403 | 422 | 502
    ) =>
      apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error },
        responseStatusCode
      })

    if (parsed.data.enabled) {
      const requirements = getBlueskyRequirements(currentActor)
      if (requirements.length) return errorResponse(requirements.join(' '), 422)
      if (!(await canFederateWithDomain(database, BLUESKY_BRIDGE_DOMAIN))) {
        return errorResponse(
          'This instance does not federate with bsky.brid.gy.',
          403
        )
      }
    }

    try {
      const storedBot = await getStoredBlueskyBridge(database)
      const targetActorId =
        storedBot?.id ??
        (await getWebfingerSelf({
          account: `${BLUESKY_BRIDGE_DOMAIN}@${BLUESKY_BRIDGE_DOMAIN}`
        }))
      // The bridge account has one canonical identity; never follow a different
      // actor handed back by a bad or compromised discovery response.
      if (!targetActorId || targetActorId !== BLUESKY_BRIDGE_ACTOR_ID) {
        return errorResponse(
          'The Bluesky bridge is unreachable. Please try again.',
          502
        )
      }

      if (parsed.data.enabled) {
        const block = await database.getBlock({
          actorId: currentActor.id,
          targetActorId
        })
        if (block) {
          await unblockActor({ database, currentActor, targetActorId })
        }
        const result = await followActor({
          database,
          currentActor,
          requestedActorId: targetActorId
        })
        if (result.type !== 'ok') {
          return errorResponse(
            'Unable to follow the Bluesky bridge. Please try again.',
            502
          )
        }
      } else {
        const result = await blockActor({
          database,
          currentActor,
          requestedActorId: targetActorId
        })
        if (result.type !== 'ok') {
          return errorResponse(
            'Unable to block the Bluesky bridge. Please try again.',
            502
          )
        }
      }
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: await getBlueskySharingState(database, currentActor)
      })
    } catch (error) {
      logger.error({
        message: 'Failed to update Bluesky sharing',
        actorId: currentActor.id,
        err: toLoggableError(error)
      })
      return errorResponse(
        'Unable to reach the Bluesky bridge. Please try again.',
        502
      )
    }
  })
)
