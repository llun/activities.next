import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  sanitizeNavHidden,
  sanitizeNavOrder
} from '@/lib/services/navigation/navPreferences'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// Web-internal write path for the sidebar customization (Settings →
// Navigation, and the sidebar's own ⋯ menu). Private per-user settings on the
// actor, so they never reach the public Mastodon preferences endpoints.
//
// Every request carries the complete list rather than a delta: the browser can
// fire several edits in a row, and a full snapshot makes the last write win
// instead of interleaving. An empty array is a valid reset to the shipped
// defaults, so the ids are validated as loose strings here and narrowed to
// known, unpinned items by the sanitizers below.
const NavigationPreferencesRequest = z
  .object({
    navOrder: z.array(z.string().max(32)).max(64).optional(),
    navHidden: z.array(z.string().max(32)).max(64).optional()
  })
  // Require at least one known key so an empty (or unknown-only) body doesn't
  // trigger a no-op updateActor write.
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one navigation preference is required'
  })

export const POST = traceApiRoute(
  'updateNavigationPreferences',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    let body
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(400)
    }

    const parsed = NavigationPreferencesRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(400)
    }

    const { navOrder, navHidden } = parsed.data
    await database.updateActor({
      actorId: currentActor.id,
      ...(navOrder !== undefined
        ? { navOrder: sanitizeNavOrder(navOrder) }
        : null),
      ...(navHidden !== undefined
        ? { navHidden: sanitizeNavHidden(navHidden) }
        : null)
    })

    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { status: 'OK' }
    })
  })
)
