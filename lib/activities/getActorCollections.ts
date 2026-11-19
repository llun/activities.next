import { isActivityPubDocumentResponse } from '@/lib/activities/activityPubResponse'
import {
  OrderedCollection,
  OrderedCollectionPage,
  getOrderCollectionFirstPage,
  toCollectionItems
} from '@/lib/activities/orderedCollection'
import { signedActivityPubRequest } from '@/lib/activities/signedRequest'
import { isFederatedRedirect } from '@/lib/services/federation/federatedRedirect'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { isSameActivityPubOrigin } from '@/lib/utils/activitypub'
import { toLoggableUrl } from '@/lib/utils/loggableUrl'
import { logger } from '@/lib/utils/logger'
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

// A URL an actor's documents name (a collection, an outbox item) can be on
// another host. The caller vetted only the actor's own origin, so a URL
// elsewhere is fetched only when federation policy allows its host. An
// unparseable URL is refused. `isFederatedRedirect` answers false when the
// policy cannot be read, which is the right answer for these read-only paths.
export const isFederatedUrlForActor = async (url: string, actorId: string) => {
  if (isSameActivityPubOrigin(url, actorId)) return true
  try {
    return await isFederatedRedirect(new URL(url))
  } catch {
    return false
  }
}

// Fetch an ActivityPub collection root document (no page follow). Shared by
// the full collection fetch below and the counts-only helper
// (getActorCollectionCounts) so the fetch semantics stay in one place. A
// non-200 response, or a 200 not labelled ActivityPub, yields a null
// collection; network errors propagate for the caller to handle. A URL on a
// host federation policy refuses is a failed fetch with no request made.
export const fetchCollectionRoot = async ({
  url,
  actorId,
  signingActor
}: {
  url: string
  actorId: string
  signingActor?: DomainActor
}): Promise<{ statusCode: number; collection: OrderedCollection | null }> => {
  if (!(await isFederatedUrlForActor(url, actorId))) {
    return { statusCode: 0, collection: null }
  }
  let response
  try {
    response = await signedActivityPubRequest({
      actor: signingActor,
      method: 'GET',
      url,
      // The host just checked must not hand the request to one policy refuses.
      requestOptions: { allowCrossHostRedirects: isFederatedRedirect }
    })
  } catch (error) {
    // A refused redirect is a refusal, like the check above, not a failure.
    if ((error as NodeJS.ErrnoException).code === 'ERR_CROSS_HOST_REDIRECT') {
      return { statusCode: 0, collection: null }
    }
    throw error
  }
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
        actorId: person.id,
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

      // The page URL is named by the remote document, so it can point at
      // another host. Refuse it before the signed request when federation
      // policy does not allow that host.
      if (!(await isFederatedUrlForActor(collectionPageUrl, person.id))) {
        span.setAttributes({
          url: toLoggableUrl(collectionPageUrl) ?? 'unrecognised',
          status: 0
        })
        span.recordException(
          new Error(`Person ${field} page is on a non-federated domain`)
        )
        return {
          page: null,
          totalItems: collectionTotalItems
        }
      }

      try {
        const response = await signedActivityPubRequest({
          actor: signingActor,
          method: 'GET',
          url: collectionPageUrl,
          requestOptions: { allowCrossHostRedirects: isFederatedRedirect }
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
