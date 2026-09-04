import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import {
  OrderedCollection,
  OrderedCollectionPage,
  getOrderCollectionFirstPage
} from '@/lib/activities/orderedCollection'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { withSpan } from '@/lib/utils/trace'

interface Params {
  person: Actor
  field: 'following' | 'followers' | 'outbox'
  signingActor?: DomainActor
  pageUrl?: string
}

export const isCollectionPageUrl = (pageUrl: string, collectionUrl: string) => {
  try {
    const page = new URL(pageUrl)
    const collection = new URL(collectionUrl)
    const pagePath = page.pathname.replace(/\/$/, '') || '/'
    const collectionPath = collection.pathname.replace(/\/$/, '') || '/'
    const collectionPrefix = collectionPath === '/' ? '/' : `${collectionPath}/`

    return (
      page.protocol === collection.protocol &&
      page.host === collection.host &&
      (pagePath === collectionPath || pagePath.startsWith(collectionPrefix))
    )
  } catch {
    return false
  }
}

// Fetch an ActivityPub collection root document (no page follow). Shared by
// the full collection fetch below and the counts-only helper
// (getActorCollectionCounts) so the fetch semantics stay in one place. A
// non-200 response yields a null collection; network errors propagate for the
// caller to handle.
export const fetchCollectionRoot = async ({
  url,
  signingActor
}: {
  url: string
  signingActor?: DomainActor
}): Promise<{ statusCode: number; collection: OrderedCollection | null }> => {
  const response = await request({
    url,
    headers: activityPubRequestHeaders({ url, signingActor })
  })
  if (response.statusCode !== 200) {
    return { statusCode: response.statusCode, collection: null }
  }
  try {
    return {
      statusCode: response.statusCode,
      collection: JSON.parse(response.body) as OrderedCollection
    }
  } catch {
    // A 200 with an empty or non-JSON body is an unavailable collection, not
    // a crash for the caller.
    return { statusCode: response.statusCode, collection: null }
  }
}

export const parseTotalItems = (val: unknown): number | null => {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
    return null
  }
  return Math.floor(val)
}

export const getActorCollections = async ({
  person,
  field,
  signingActor,
  pageUrl
}: Params) => {
  return withSpan(
    'activity',
    field,
    {
      actorId: person.id,
      field
    },
    async (span) => {
      if (!person[field]) {
        span.recordException(new Error(`Person ${field} is undefined`))
        return null
      }

      const fieldResponse = await fetchCollectionRoot({
        url: person[field],
        signingActor
      })
      if (!fieldResponse.collection) {
        span.setAttributes({
          url: person[field],
          status: fieldResponse.statusCode
        })
        span.recordException(
          new Error(`Person ${field} returns ${fieldResponse.statusCode}`)
        )
        return null
      }

      const collection = fieldResponse.collection
      if (
        Array.isArray(collection.orderedItems) &&
        collection.orderedItems.length > 0
      ) {
        return {
          page: {
            '@context': collection['@context'],
            type: 'OrderedCollectionPage' as const,
            orderedItems: collection.orderedItems
          },
          totalItems:
            parseTotalItems(collection.totalItems) ??
            collection.orderedItems.length
        }
      }

      const firstPageUrl = getOrderCollectionFirstPage(collection)
      const collectionPageUrl =
        pageUrl && isCollectionPageUrl(pageUrl, person[field])
          ? pageUrl
          : firstPageUrl

      const collectionTotalItems = parseTotalItems(collection.totalItems)

      // Return totalItems even if page URL is not available
      // This is common for remote actors where Mastodon only provides totalItems
      // without exposing the actual list of followers/following
      if (!collectionPageUrl) {
        return {
          page: null,
          totalItems: collectionTotalItems
        }
      }

      try {
        const response = await request({
          url: collectionPageUrl,
          headers: activityPubRequestHeaders({
            url: collectionPageUrl,
            signingActor
          })
        })
        if (response.statusCode !== 200) {
          span.setAttributes({
            url: collectionPageUrl,
            status: response.statusCode
          })
          span.recordException(
            new Error(
              `Person ${field} with page returns ${response.statusCode}`
            )
          )
          // Return totalItems even if page fetch fails
          return {
            page: null,
            totalItems: collectionTotalItems
          }
        }
        const page = JSON.parse(response.body) as OrderedCollectionPage
        const pageTotalItems = parseTotalItems(page.totalItems)
        return {
          page,
          totalItems: collectionTotalItems ?? pageTotalItems
        }
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        logger.error(`[getActorCollections.${field}] ${nodeError.message}`)
        // Return totalItems even on error
        return {
          page: null,
          totalItems: collectionTotalItems
        }
      }
    }
  )
}
