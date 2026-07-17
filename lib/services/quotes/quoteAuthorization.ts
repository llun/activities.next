import { QUOTE_ACTIVITY_CONTEXT } from '@/lib/activities/quoteContext'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// The hosted QuoteAuthorization stamp lives under the quoted author's actor:
//   <actorId>/quote_authorizations/<hash of the quoting note id>
// The hash keys it stably to one (quoting note → quoted status) edge and is
// URL-safe. The quoted author's actor id is `https://<host>/users/<username>`,
// so the stamp path segment mirrors the `/users/[username]/quote_authorizations/
// [id]` route.
export const buildQuoteAuthorizationId = (quotingStatusId: string): string =>
  getHashFromString(quotingStatusId)

export const buildQuoteAuthorizationUri = (
  quotedActorId: string,
  quotingStatusId: string
): string =>
  `${quotedActorId}/quote_authorizations/${buildQuoteAuthorizationId(quotingStatusId)}`

type QuoteAuthorizationObjectParams = {
  stampUri: string
  // The quoted author (issuer).
  attributedTo: string
  // The quoting note.
  interactingObject: string
  // The quoted status.
  interactionTarget: string
}

// The dereferenceable QuoteAuthorization JSON-LD object served by the stamp
// route (and referenced from the quoter's re-federated note).
export const buildQuoteAuthorizationObject = ({
  stampUri,
  attributedTo,
  interactingObject,
  interactionTarget
}: QuoteAuthorizationObjectParams) => ({
  '@context': QUOTE_ACTIVITY_CONTEXT,
  id: stampUri,
  type: 'QuoteAuthorization',
  attributedTo,
  interactingObject,
  interactionTarget
})
