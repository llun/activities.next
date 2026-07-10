import { z } from 'zod'

import {
  MAX_COLLECTION_ACCOUNT_IDS,
  addMembersToCollection
} from '@/lib/services/collections/addMembers'
import {
  getCollectionEntities,
  resolveCollectionWrite,
  wrapCollection
} from '@/lib/services/collections/serializers'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
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

// List the authenticated actor's collections. activities.next extension: the
// final Mastodon 4.6 API has no owner-list endpoint, so this stays a bare
// array (of the merged 4.6 + extension entities) for the first-party UI.
export const GET = traceApiRoute(
  'getCollections',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:collections']],
    async (req, { database, currentActor }) => {
      const collections = await database.getCollections({
        actorId: currentActor.id
      })
      const entities = await getCollectionEntities(
        database,
        collections,
        'owner'
      )
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: entities
      })
    }
  )
)

// Dual request vocabulary: the final Mastodon 4.6 params (name/tag_name/
// discoverable/sensitive/account_ids) plus the pre-final activities.next
// extension params (title/topic/visibility/feed_enabled). Spec params win when
// both vocabularies are present. `sensitive`/`discoverable` use strict
// z.boolean() on purpose: a string 'false' must never flip a collection
// public, and this API is JSON-only.
const CreateCollectionBody = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    tag_name: CollectionTopicInput,
    discoverable: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    account_ids: z
      .array(z.string().min(1))
      .max(MAX_COLLECTION_ACCOUNT_IDS)
      .optional(),
    title: z.string().trim().min(1).max(255).optional(),
    topic: CollectionTopicInput,
    visibility: CollectionVisibility.optional(),
    // activities.next extension: expose the collection as a shareable feed.
    feed_enabled: z.coerce.boolean().optional(),
    description: z.string().max(2000).nullable().optional(),
    language: z.string().trim().max(10).nullable().optional()
  })
  .refine((body) => body.name !== undefined || body.title !== undefined, {
    message: 'name is required'
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

      const { title, topic, visibility } = resolveCollectionWrite(parsed.data)
      const collection = await database.createCollection({
        actorId: currentActor.id,
        // The refine above guarantees one of name/title is present.
        title: title as string,
        description: parsed.data.description,
        topic,
        language: parsed.data.language,
        visibility,
        sensitive: parsed.data.sensitive,
        publicFeed: parsed.data.feed_enabled
      })

      if (parsed.data.account_ids && parsed.data.account_ids.length > 0) {
        await addMembersToCollection({
          database,
          collectionId: collection.id,
          ownerActorId: currentActor.id,
          accountIds: parsed.data.account_ids
        })
      }

      const [entity] = await getCollectionEntities(
        database,
        [collection],
        'owner'
      )
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: wrapCollection(entity)
      })
    }
  )
)
