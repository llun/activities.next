import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { toMastodonCustomEmoji } from '@/lib/types/domain/customEmoji'
import { HttpMethod } from '@/lib/utils/http-headers'
import { HTTP_STATUS, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Public, unauthenticated — Mastodon serves GET /api/v1/custom_emojis without a
// token. Returns the `listed` set: enabled (`disabled = false`) AND
// `visible_in_picker = true`, matching Mastodon's `CustomEmoji.listed` scope.
export const GET = traceApiRoute(
  'getCustomEmojis',
  async (req: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Database unavailable' },
        responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      })
    }

    const emojis = await database.getCustomEmojis()
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: emojis
        .filter((emoji) => emoji.visibleInPicker)
        .map(toMastodonCustomEmoji)
    })
  }
)
