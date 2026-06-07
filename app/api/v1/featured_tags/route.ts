import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonFeaturedTag } from '@/lib/services/mastodon/getMastodonFeaturedTag'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Mastodon hashtag names are word characters only. Strip a single leading `#`
// and any surrounding whitespace before validating the bare name.
const FeaturedTagNameRegex = /^[\p{L}\p{N}_]+$/u
const CreateFeaturedTagRequest = z.object({
  name: z
    .string()
    .trim()
    .max(255)
    .transform((value) => value.replace(/^#+/, ''))
    .refine((value) => FeaturedTagNameRegex.test(value), {
      message: 'Invalid hashtag name'
    })
})

// GET /api/v1/featured_tags — the current user's featured tags.
// https://docs.joinmastodon.org/methods/featured_tags/#get
// Scope read:accounts (satisfied by aggregate `read`).
export const GET = traceApiRoute(
  'getFeaturedTags',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { database, currentActor } = context
      const host = headerHost(req.headers)
      const tags = await database.getFeaturedTags({ actorId: currentActor.id })
      const data = tags.map((tag) =>
        getMastodonFeaturedTag({ host, actor: currentActor, tag })
      )
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    },
    guardOptions
  )
)

// POST /api/v1/featured_tags — feature a hashtag on the current profile.
// https://docs.joinmastodon.org/methods/featured_tags/#feature
// Scope write:accounts. Returns 422 when the tag is already featured (matching
// Mastodon's uniqueness validation on the normalized name).
export const POST = traceApiRoute(
  'createFeaturedTag',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:accounts']],
    async (req, context) => {
      const { database, currentActor } = context

      let json: unknown
      try {
        json = await req.json()
      } catch {
        json = {}
      }
      const parsed = CreateFeaturedTagRequest.safeParse(json)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid hashtag name' },
          responseStatusCode: 422
        })
      }

      const { name } = parsed.data
      const existing = await database.getFeaturedTagByName({
        actorId: currentActor.id,
        name
      })
      if (existing) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Tag is already featured' },
          responseStatusCode: 422
        })
      }

      const tag = await database.createFeaturedTag({
        actorId: currentActor.id,
        name
      })
      const host = headerHost(req.headers)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonFeaturedTag({ host, actor: currentActor, tag })
      })
    },
    guardOptions
  )
)
