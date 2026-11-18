import { isActivityPubDocumentResponse } from '@/lib/activities/activityPubResponse'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { signedActivityPubRequest } from '@/lib/activities/signedRequest'
import { getDatabase } from '@/lib/database'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import {
  isSameActivityPubOrigin,
  normalizeActorId
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { CrossHostRedirectPolicy } from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'
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
  signingActor,
  allowCrossHostRedirects
}: {
  url: string
  withNetworkRetry: boolean
  signingActor?: DomainActor
  allowCrossHostRedirects: CrossHostRedirectPolicy
}): Promise<FetchedActorDocument | null> => {
  const response = await signedActivityPubRequest({
    actor: signingActor,
    method: 'GET',
    url,
    requestOptions: {
      // Use default retry by set it to undefined, otherwise 0 retry
      numberOfRetry: withNetworkRetry ? undefined : 0,
      allowCrossHostRedirects
    }
  })
  if (!isActivityPubDocumentResponse(response, url)) {
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

// The caller vetted only the URL it asked for, so a redirect onto another host
// is followed only when federation policy allows that host: a blocked or
// non-allowlisted host must not be contacted, nor answer for the actor.
const isFederatedRedirect = async (url: URL) => {
  try {
    const database = getDatabase()
    return database ? await canFederateWithDomain(database, url.href) : false
  } catch (error) {
    // Refuse rather than throw: a thrown database error can carry a network
    // code that `request()` retries, re-contacting the redirecting host.
    logger.warn({
      message: 'Refused a redirect whose federation policy could not be read',
      redirectHost: url.host.slice(0, 512),
      err: toLoggableError(error)
    })
    return false
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
// origin its id belongs to. The claimed origin is checked against federation
// policy first: the caller vetted only the URL it asked for, and a blocked or
// non-allowlisted host must not get a (possibly instance-signed) request.
export const getActorPerson: GetActorPersonFunction = ({
  actorId,
  withNetworkRetry = true,
  signingActor
}) =>
  withSpan('activity', 'getActorProfile', { actorId }, async (span) => {
    // For the refusal warning: which fetch was redirected, and where to.
    let requestedUrl = actorId
    let refusedRedirectHost: string | undefined
    const refuseRedirect = (url: URL) => {
      // Capped like every remote string logged here: a `Location` host can run
      // to the header size limit.
      refusedRedirectHost = url.host.slice(0, 512)
      return false
    }
    try {
      const fetched = await fetchActorDocument({
        url: actorId,
        withNetworkRetry,
        signingActor,
        allowCrossHostRedirects: async (url) =>
          (await isFederatedRedirect(url)) || refuseRedirect(url)
      })
      if (!fetched) return null
      if (isSameActivityPubOrigin(fetched.person.id, fetched.servedFrom)) {
        return fetched.person
      }

      const claimedId = fetched.person.id
      // Parsed once and used for both the policy check and the fetch: the
      // policy helpers read a scheme only before a literal `://`, so a raw
      // `https:/blocked.example/...` would be judged as host `https` while the
      // request layer's URL parser sends it to blocked.example.
      const claimedUrl = new URL(claimedId).href
      const database = getDatabase()
      if (!database || !(await canFederateWithDomain(database, claimedUrl))) {
        logger.warn({
          message:
            'Skipped re-fetching an actor id claimed on a non-federated domain',
          requestedActorId: actorId,
          // The remote chooses this string; a prefix is enough to diagnose.
          claimedActorId: claimedId.slice(0, 512)
        })
        return null
      }
      requestedUrl = claimedUrl
      const canonical = await fetchActorDocument({
        url: claimedUrl,
        withNetworkRetry,
        signingActor,
        // Only the claimed origin can confirm the id, so a hop to another
        // host could never be accepted; refuse it before that host is sent
        // the request.
        allowCrossHostRedirects: refuseRedirect
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
        claimedActorId: claimedId.slice(0, 512)
      })
      return null
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code === 'ERR_CROSS_HOST_REDIRECT') {
        span.setAttribute('crossHostRedirect', true)
        logger.warn({
          message: 'Refused an actor fetch that redirects to another host',
          // Hosts only: the requested URL may carry a token in its query.
          requestedHost: new URL(requestedUrl).host.slice(0, 512),
          refusedRedirectHost
        })
        return null
      }
      span.recordException(nodeError)
      logger.error(`[getActorProfile] ${nodeError.message}`)
      return null
    }
  })
