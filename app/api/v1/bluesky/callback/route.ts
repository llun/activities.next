import { NextRequest } from 'next/server'

import { buildBaseURL } from '@/lib/config'
import { completeBlueskyOAuth } from '@/lib/services/bluesky/account'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

// Where the Bluesky authorization server sends the browser back. Behind the
// sign-in guard: the state names the actor that started it, and only that
// actor may finish it.
export const GET = traceApiRoute(
  'blueskyOAuthCallback',
  AuthenticatedGuard(async (req: NextRequest, { currentActor, database }) => {
    const result = await completeBlueskyOAuth(
      database,
      currentActor,
      new URL(req.url).searchParams
    )
    const url = new URL('/settings/networks', buildBaseURL(currentActor.domain))
    url.searchParams.set('bluesky', result)
    return Response.redirect(url.toString(), 303)
  })
)
