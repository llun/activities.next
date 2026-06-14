import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// Web-internal write path for the Mastodon `reading:*` preferences. These are
// private per-user settings persisted on the actor; the public
// GET /api/v1/preferences endpoint stays read-only by design, so the
// Preferences settings page saves reading defaults here while posting defaults
// go through the standard PATCH /api/v1/accounts/update_credentials.
const ReadingPreferencesRequest = z.object({
  readingExpandMedia: z.enum(['default', 'show_all', 'hide_all']).optional(),
  readingExpandSpoilers: z.boolean().optional(),
  readingAutoplayGifs: z.boolean().optional()
})

export const POST = traceApiRoute(
  'updateReadingPreferences',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    let body
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(400)
    }

    const parsed = ReadingPreferencesRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(400)
    }

    await database.updateActor({
      actorId: currentActor.id,
      ...parsed.data
    })

    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { status: 'OK' }
    })
  })
)
