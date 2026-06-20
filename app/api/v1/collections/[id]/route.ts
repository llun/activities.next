import { z } from 'zod'

import { Database } from '@/lib/database/types'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonCollection } from '@/lib/services/mastodon/getMastodonCollection'
import { Scope } from '@/lib/types/database/operations'
import { CollectionVisibility } from '@/lib/types/domain/collection'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const approvedSize = async (
  database: Database,
  actorId: string,
  collectionId: string
): Promise<number> => {
  const sizes = await database.getCollectionMemberCounts({
    actorId,
    collectionIds: [collectionId],
    approvedOnly: true
  })
  return sizes[collectionId] ?? 0
}

export const GET = traceApiRoute(
  'getCollection',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const collection = await database.getCollection({
        id,
        actorId: currentActor.id
      })
      if (!collection) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonCollection(
          collection,
          await approvedSize(database, currentActor.id, id)
        )
      })
    }
  )
)

const UpdateCollectionBody = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  topic: z.string().trim().max(255).nullable().optional(),
  language: z.string().trim().max(10).nullable().optional(),
  visibility: CollectionVisibility.optional(),
  feed_enabled: z.coerce.boolean().optional()
})

// Mastodon 4.6 uses PATCH to update a collection.
export const PATCH = traceApiRoute(
  'updateCollection',
  OAuthGuard<Params>(
    [Scope.enum['write:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const json = await req.json().catch(() => null)
      const parsed = UpdateCollectionBody.safeParse(json)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const collection = await database.updateCollection({
        id,
        actorId: currentActor.id,
        title: parsed.data.title,
        description: parsed.data.description,
        topic: parsed.data.topic,
        language: parsed.data.language,
        visibility: parsed.data.visibility,
        publicFeed: parsed.data.feed_enabled
      })
      if (!collection) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonCollection(
          collection,
          await approvedSize(database, currentActor.id, id)
        )
      })
    }
  )
)

export const DELETE = traceApiRoute(
  'deleteCollection',
  OAuthGuard<Params>(
    [Scope.enum['write:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const deleted = await database.deleteCollection({
        id,
        actorId: currentActor.id
      })
      if (!deleted) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
