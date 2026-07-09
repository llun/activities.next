import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonFeaturedTag } from '@/lib/services/mastodon/getMastodonFeaturedTag'
import { Scope } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { isMastodonHashtagName } from '@/lib/utils/text/mastodonHashtag'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

// Mastodon caps featured tags per account at FeaturedTag::LIMIT = 10.
const FEATURED_TAGS_LIMIT = 10

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Mastodon hashtag names are word characters only. Strip a single leading `#`
// and any surrounding whitespace before validating the bare name.
const CreateFeaturedTagRequest = z.object({
  name: z
    .string()
    .trim()
    .max(255)
    .transform((value) => value.replace(/^#+/, ''))
    .refine((value) => isMastodonHashtagName(value), {
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
// Scope write:accounts. Idempotent on an already-featured tag (returns it with
// 200, like Mastodon); 422 on an invalid name or once the per-account cap of 10
// is reached.
export const POST = traceApiRoute(
  'createFeaturedTag',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:accounts']],
    async (req, context) => {
      const { database, currentActor } = context

      const json = await getRequestBody(req).catch(() => ({}))
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
      const host = headerHost(req.headers)

      // Idempotent, matching Mastodon's CreateFeaturedTagService
      // (find_or_initialize_by): re-featuring an already-featured tag returns
      // the existing entry with 200 rather than erroring.
      const existing = await database.getFeaturedTagByName({
        actorId: currentActor.id,
        name
      })
      if (existing) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: getMastodonFeaturedTag({
            host,
            actor: currentActor,
            tag: existing
          })
        })
      }

      // The per-account cap only applies when adding a NEW tag (re-featuring an
      // existing one above is always allowed).
      const featuredCount = await database.countFeaturedTags({
        actorId: currentActor.id
      })
      if (featuredCount >= FEATURED_TAGS_LIMIT) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            error: `You can only feature up to ${FEATURED_TAGS_LIMIT} hashtags`
          },
          responseStatusCode: 422
        })
      }

      const tag = await database.createFeaturedTag({
        actorId: currentActor.id,
        name
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonFeaturedTag({ host, actor: currentActor, tag })
      })
    },
    guardOptions
  )
)
