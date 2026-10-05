import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import {
  isSameActivityPubOrigin,
  normalizeActorId
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { withSpan } from '@/lib/utils/trace'

export type GetActorPersonFunction = (params: {
  actorId: string
  withNetworkRetry?: boolean
  signingActor?: DomainActor
}) => Promise<Actor | null>

type FetchedActorDocument = {
  person: Actor
  // The URL the body was actually served from, after redirects. Only this
  // origin speaks for the document; the requested URL may have redirected.
  servedFrom: string
}

const fetchActorDocument = async ({
  url,
  withNetworkRetry,
  signingActor
}: {
  url: string
  withNetworkRetry: boolean
  signingActor?: DomainActor
}): Promise<FetchedActorDocument | null> => {
  const response = await request({
    url,
    headers: activityPubRequestHeaders({
      url,
      signingActor
    }),
    // Use default retry by set it to undefined, otherwise 0 retry
    numberOfRetry: withNetworkRetry ? undefined : 0
  })
  if (response.statusCode !== 200) {
    return null
  }
  const compactedActor = await compactActivityPub(JSON.parse(response.body))
  const actorResult = Actor.safeParse(compactedActor)
  if (!actorResult.success) {
    logger.error(`[getActorProfile] ${actorResult.error.message}`)
    return null
  }
  return {
    person: actorResult.data,
    servedFrom: response.url ?? url
  }
}

// An actor document's own `id` is a claim by whoever answered the request (see
// "A Fetched Document's Own id Is Not Evidence" in
// docs/mastodon-api-compatibility.md). Every caller keys database writes —
// actor rows, public keys, inboxes — on `person.id`, so a server must never be
// able to answer for an id on another origin: that is how a hostile WebFinger
// target planted its own key under a victim's (or a LOCAL actor's) id.
//
// A document served from the origin its `id` names is accepted as-is. One
// whose `id` names a different origin (a split-domain deployment whose
// WebFinger `self` link points at an alias) is re-fetched ONCE from the id it
// claims, Mastodon-style, and accepted only when that origin serves a document
// with the very same id. Either way the returned actor was published by the
// origin its id belongs to.
export const getActorPerson: GetActorPersonFunction = ({
  actorId,
  withNetworkRetry = true,
  signingActor
}) =>
  withSpan('activity', 'getActorProfile', { actorId }, async (span) => {
    try {
      const fetched = await fetchActorDocument({
        url: actorId,
        withNetworkRetry,
        signingActor
      })
      if (!fetched) return null
      if (isSameActivityPubOrigin(fetched.person.id, fetched.servedFrom)) {
        return fetched.person
      }

      const claimedId = fetched.person.id
      const canonical = await fetchActorDocument({
        url: claimedId,
        withNetworkRetry,
        signingActor
      })
      if (
        canonical &&
        isSameActivityPubOrigin(canonical.person.id, canonical.servedFrom) &&
        normalizeActorId(canonical.person.id) === normalizeActorId(claimedId)
      ) {
        return canonical.person
      }

      logger.warn({
        message:
          'Rejected actor document whose id is not served by its own origin',
        requestedActorId: actorId,
        servedFrom: fetched.servedFrom,
        claimedActorId: claimedId
      })
      return null
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      span.recordException(nodeError)
      logger.error(`[getActorProfile] ${nodeError.message}`)
      return null
    }
  })
