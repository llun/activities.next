import { NextRequest } from 'next/server'
import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { AuthenticatedApiHandle } from '@/lib/services/guards/types'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.PUT,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
  name: string
}

// A reaction name is either a unicode emoji or a custom-emoji shortcode. Keep
// the constraint minimal: non-empty and capped at 100 chars as a product limit
// (well under the varchar(255) column) so we don't over-restrict legitimate
// emoji/shortcode characters.
const ReactionName = z.string().trim().min(1).max(100)

const reactionHandler =
  (mode: 'add' | 'remove'): AuthenticatedApiHandle<Params> =>
  async (req, { database, currentActor, params }) => {
    const { id, name } = await params

    // Next.js App Router already percent-decodes dynamic route segments, so
    // `name` is the decoded emoji/shortcode; we must not decode it again.
    const parsed = ReactionName.safeParse(name)
    if (!parsed.success) {
      return apiCorsError(req, CORS_HEADERS, 422)
    }

    const announcement = await database.getAnnouncement({ id })
    if (!announcement) return apiCorsError(req, CORS_HEADERS, 404)

    if (mode === 'add') {
      await database.addAnnouncementReaction({
        announcementId: id,
        actorId: currentActor.id,
        name: parsed.data
      })
    } else {
      await database.removeAnnouncementReaction({
        announcementId: id,
        actorId: currentActor.id,
        name: parsed.data
      })
    }

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
  }

const addAttributes = async (
  _req: NextRequest,
  context: { params: Promise<Params> }
) => {
  const params = await context.params
  return { announcementId: params?.id || 'unknown' }
}

export const PUT = traceApiRoute(
  'addAnnouncementReaction',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:favourites']],
    reactionHandler('add'),
    guardOptions
  ),
  { addAttributes }
)

export const DELETE = traceApiRoute(
  'removeAnnouncementReaction',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:favourites']],
    reactionHandler('remove'),
    guardOptions
  ),
  { addAttributes }
)
