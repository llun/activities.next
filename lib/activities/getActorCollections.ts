import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { isActivityPubDocumentResponse } from '@/lib/activities/activityPubResponse'
import {
  OrderedCollection,
  OrderedCollectionPage,
  getOrderCollectionFirstPage,
  toCollectionItems
} from '@/lib/activities/orderedCollection'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { withSpan } from '@/lib/utils/trace'
import { isRecord } from '@/lib/utils/typeGuards'

import { applyInheritedContext } from './inheritActivityPubContext'

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
// non-200 response, or a 200 not labelled ActivityPub, yields a null
// collection; network errors propagate for the caller to handle.
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
  if (!isActivityPubDocumentResponse(response, url)) {
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
      // A root inlining a single item may serve it as the bare value rather
      // than a one-element array, so read it through toCollectionItems.
      const inlineItems = toCollectionItems(collection.orderedItems)
      if (inlineItems.length > 0) {
        return {
          page: {
            '@context': collection['@context'],
            type: 'OrderedCollectionPage' as const,
            orderedItems: inlineItems
          },
          totalItems:
            parseTotalItems(collection.totalItems) ?? inlineItems.length
        }
      }

      const firstPageUrl = getOrderCollectionFirstPage(collection)
      // A caller-supplied page is honoured only for a collection that exposes
      // its pages at all. A root that advertises no `first` (and no inline
      // items, handled above) is hiding its members — Mastodon's
      // hide_collections, or any server that hides by omission — so a guessed
      // page URL must not be fetched, signed, on a local user's behalf.
      const collectionPageUrl =
        firstPageUrl && pageUrl && isCollectionPageUrl(pageUrl, person[field])
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
        if (!isActivityPubDocumentResponse(response, collectionPageUrl)) {
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
        const rawPage = JSON.parse(response.body) as OrderedCollectionPage
        const page = (
          isRecord(rawPage)
            ? applyInheritedContext(collection['@context'], rawPage)
            : rawPage
        ) as OrderedCollectionPage
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
