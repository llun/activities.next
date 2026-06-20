import { z } from 'zod'

import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonCollection } from '@/lib/services/mastodon/getMastodonCollection'
import { Scope } from '@/lib/types/database/operations'
import { CollectionVisibility } from '@/lib/types/domain/collection'
import { CollectionTopicInput } from '@/lib/types/mastodon/collection'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_422, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// List the authenticated actor's collections (Mastodon 4.6 Collections API).
export const GET = traceApiRoute(
  'getCollections',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:collections']],
    async (req, { database, currentActor }) => {
      const collections = await database.getCollections({
        actorId: currentActor.id
      })
      const sizes = await database.getCollectionMemberCounts({
        actorId: currentActor.id,
        collectionIds: collections.map((collection) => collection.id),
        approvedOnly: true
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: collections.map((collection) =>
          getMastodonCollection(collection, sizes[collection.id] ?? 0)
        )
      })
    }
  )
)

const CreateCollectionBody = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  topic: CollectionTopicInput,
  language: z.string().trim().max(10).nullable().optional(),
  visibility: CollectionVisibility.optional(),
  // activities.next extension: expose the collection as a shareable feed.
  feed_enabled: z.coerce.boolean().optional()
})

export const POST = traceApiRoute(
  'createCollection',
  OAuthGuard(
    [Scope.enum['write:collections']],
    async (req, { database, currentActor }) => {
      const json = await req.json().catch(() => null)
      const parsed = CreateCollectionBody.safeParse(json)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const collection = await database.createCollection({
        actorId: currentActor.id,
        title: parsed.data.title,
        description: parsed.data.description,
        topic: parsed.data.topic,
        language: parsed.data.language,
        visibility: parsed.data.visibility,
        publicFeed: parsed.data.feed_enabled
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonCollection(collection, 0)
      })
    }
  )
)
