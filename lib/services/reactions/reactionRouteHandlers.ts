import { NextRequest } from 'next/server'
import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { refetchedStatusResponse } from '@/lib/services/mastodon/statusActionResponse'
import {
  reactStatus,
  unreactStatus
} from '@/lib/services/reactions/reactStatus'
import {
  MAX_REACTIONS_PER_ACTOR,
  MAX_REACTION_NAME_LENGTH
} from '@/lib/services/statuses/reactionLimits'
import { Actor } from '@/lib/types/domain/actor'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse } from '@/lib/utils/response'
import { idToUrl } from '@/lib/utils/urlToId'

// Next's App Router already percent-decodes a dynamic segment, so this is the
// emoji/shortcode itself — do not decode it again.
export const ReactionSegment = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REACTION_NAME_LENGTH)

/**
 * Shared body of every reaction write route. The Pleroma (`PUT`/`DELETE`) and
 * glitch-soc (`POST react`/`unreact`) dialects differ only in their URL and
 * method — they run the same service over the same store, so the two can never
 * report different state.
 */
export const reactionWriteHandler =
  (mode: 'react' | 'unreact', corsHeaders: HttpMethod[]) =>
  async (
    req: NextRequest,
    {
      database,
      currentActor,
      params
    }: {
      database: Database
      currentActor: Actor
      params: Promise<{ id: string; emoji?: string; name?: string }>
    }
  ) => {
    const { id, emoji, name } = await params
    if (!id) return apiCorsError(req, corsHeaders, 404)

    const segment = ReactionSegment.safeParse(emoji ?? name)
    if (!segment.success) return apiCorsError(req, corsHeaders, 422)

    const statusId = idToUrl(id)
    const act = mode === 'react' ? reactStatus : unreactStatus
    const result = await act({
      database,
      currentActor,
      statusId,
      name: segment.data
    })

    if (!result.ok) {
      if (result.reason === 'not-found') {
        return apiCorsError(req, corsHeaders, 404)
      }

      // `invalid-emoji` and `cap-reached` are both unprocessable input, and
      // both are permanent for this request — the client shows the message
      // rather than inviting a retry that would fail identically. Mastodon's
      // own errors carry a human-readable `error` string, so this stays in
      // dialect.
      return apiResponse({
        req,
        allowedMethods: corsHeaders,
        data: {
          error:
            result.reason === 'cap-reached'
              ? `You can only add ${MAX_REACTIONS_PER_ACTOR} reactions to a post.`
              : 'That emoji cannot be used as a reaction.',
          // Marks `error` as copy written for a person, so a client can show it
          // as-is. Without it a client cannot tell this apart from the generic
          // `{ error: 'Unprocessable entity' }` every other 4xx returns.
          reason: result.reason
        },
        responseStatusCode: 422
      })
    }

    // Both dialects answer with the affected Status, refetched so the caller
    // sees its own reaction reflected in the rollups.
    return refetchedStatusResponse({
      req,
      database,
      currentActor,
      statusId,
      allowedMethods: corsHeaders
    })
  }

export const reactionRouteAttributes = async (
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const params = await context.params
  return { statusId: params?.id || 'unknown' }
}
