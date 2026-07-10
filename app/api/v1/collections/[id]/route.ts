import { z } from 'zod'

import {
  getCollectionEntities,
  resolveCollectionWrite,
  wrapCollection
} from '@/lib/services/collections/serializers'
import {
  OAuthGuard,
  OptionalOAuthGuard
} from '@/lib/services/guards/OAuthGuard'
import { notifyCollectionUpdated } from '@/lib/services/notifications/collectionNotifications'
import { Scope } from '@/lib/types/database/operations'
import { CollectionVisibility } from '@/lib/types/domain/collection'
import { CollectionTopicInput } from '@/lib/types/mastodon/collection'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

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

// Read a single collection as Mastodon 4.6 CollectionWithAccounts. Anonymous
// and non-owner viewers may read public (discoverable) and unlisted
// (link-shareable) collections in the public projection (approved members
// only); private collections answer 404 to everyone but the owner
// (existence-hiding). The owner reads every consent state.
export const GET = traceApiRoute(
  'getCollection',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const collection = await database.getCollectionById({ id })
      const isOwner =
        currentActor !== null && collection?.ownerActorId === currentActor.id
      if (!collection || (!isOwner && collection.visibility === 'private')) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      const [entity] = await getCollectionEntities(
        database,
        [collection],
        isOwner ? 'owner' : 'public'
      )
      const accounts = await database.getMastodonActorsFromIds({
        ids: entity.items.map((item) => idToUrl(item.account_id))
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { accounts, collection: entity }
      })
    },
    { matchMode: 'any' }
  )
)

// Dual vocabulary, matching POST minus account_ids (see collections/route.ts).
const UpdateCollectionBody = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  tag_name: CollectionTopicInput,
  discoverable: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  title: z.string().trim().min(1).max(255).optional(),
  topic: CollectionTopicInput,
  visibility: CollectionVisibility.optional(),
  feed_enabled: z.coerce.boolean().optional(),
  description: z.string().max(2000).nullable().optional(),
  language: z.string().trim().max(10).nullable().optional()
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

      const { title, topic, visibility } = resolveCollectionWrite(parsed.data)
      const collection = await database.updateCollection({
        id,
        actorId: currentActor.id,
        title,
        description: parsed.data.description,
        topic,
        language: parsed.data.language,
        visibility,
        sensitive: parsed.data.sensitive,
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

      // Notify approved local members when the collection's METADATA changed
      // (title/description/topic/language/visibility/sensitive) — not for a
      // feed-only toggle. Best-effort: notification failures must not fail the
      // update.
      const metadataChanged =
        title !== undefined ||
        parsed.data.description !== undefined ||
        topic !== undefined ||
        parsed.data.language !== undefined ||
        visibility !== undefined ||
        parsed.data.sensitive !== undefined
      if (metadataChanged) {
        const members = await database.getApprovedCollectionMembers({
          id,
          actorId: currentActor.id
        })
        await notifyCollectionUpdated(database, {
          collectionId: id,
          ownerActorId: currentActor.id,
          memberActorIds: members.map((member) => member.id)
        }).catch(() => {})
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
