import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { Database } from '@/lib/database/types'
import {
  canFederateWithDomain,
  isLocalFederationDomain
} from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/domain/actor'
import {
  parseAccountHandle,
  parseProfileUrlAccountHandle,
  stripAcctPrefix
} from '@/lib/utils/accountHandle'
import { normalizeActorId } from '@/lib/utils/activitypub'

import { recordRemoteActorBestEffort } from './refreshRemoteActor'

// Anything longer than this is not an account address. The cap runs before any
// parsing so a hostile `uri` cannot push work into the URL parser or a log
// line; it is generous enough for the longest realistic actor URI.
export const ACCOUNT_TARGET_MAX_LENGTH = 2048

export type AccountTarget =
  | { type: 'handle'; username: string; domain: string; acct: string }
  | { type: 'url'; url: string }

export type ResolveAccountTargetResult =
  | { type: 'resolved'; actor: Actor }
  | { type: 'invalid' }
  | { type: 'forbidden' }
  | { type: 'not-found' }

/**
 * Normalizes every form a remote server may hand to `/authorize_interaction`
 * into either an account handle or an http(s) URL. Accepts `user@domain`,
 * `@user@domain`, `acct:user@domain`, a profile page URL and a bare
 * ActivityPub actor URI; rejects everything else (bare domains, non-http
 * schemes, over-long input) rather than guessing.
 */
export const parseAccountTarget = (input: string): AccountTarget | null => {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > ACCOUNT_TARGET_MAX_LENGTH) return null

  const withoutAcct = stripAcctPrefix(trimmed)
  if (!withoutAcct) return null

  // URL-ness is decided FIRST. A profile URL carries exactly one `@`
  // (`https://d/@user`), which `parseAccountHandle` would otherwise split into
  // the nonsense handle `https://d/` @ `user` — silently sending the most
  // common Mastodon input form to WebFinger as garbage. Anything that parses
  // as a URL is therefore never reconsidered as a handle; a non-http scheme is
  // rejected outright rather than falling through.
  try {
    const url = new URL(withoutAcct)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return { type: 'url', url: withoutAcct }
  } catch {
    // Not a URL — fall through to handle parsing.
  }

  const handle = parseAccountHandle(withoutAcct)
  if (!handle) return null

  return {
    type: 'handle',
    username: handle.username,
    domain: handle.domain,
    acct: `${handle.username}@${handle.domain}`
  }
}

const resolveHandle = async ({
  database,
  username,
  domain,
  acct,
  signingActor
}: {
  database: Database
  username: string
  domain: string
  acct: string
  signingActor?: Actor
}): Promise<ResolveAccountTargetResult> => {
  const persistedActor = await database.getActorFromUsername({
    username,
    domain
  })
  if (persistedActor) return { type: 'resolved', actor: persistedActor }

  // Never WebFinger ourselves: an unknown username on a domain this instance
  // serves is simply not an account here.
  if (await isLocalFederationDomain(database, domain)) {
    return { type: 'not-found' }
  }

  const actorId = await getWebfingerSelf({ account: acct })
  if (!actorId) return { type: 'not-found' }

  // WebFinger can point at a different host than the handle's, so the actor id
  // it returns is re-gated rather than inheriting the handle's decision.
  if (!(await canFederateWithDomain(database, actorId))) {
    return { type: 'forbidden' }
  }

  const actor = await recordRemoteActorBestEffort({
    actorId,
    database,
    signingActor
  })
  return actor ? { type: 'resolved', actor } : { type: 'not-found' }
}

/**
 * Resolves the `uri` an inbound remote-follow hands us to a persisted actor.
 *
 * The result is a closed set of outcomes so the page can render distinct copy
 * for "that is not an address", "we cannot talk to that server" and "no such
 * account" instead of collapsing them into one failure. Non-actor documents
 * (Mastodon also sends status permalinks for reply/boost intents) fall out as
 * `not-found`: getActorPerson's schema rejects them.
 */
export const resolveAccountTarget = async ({
  database,
  input
}: {
  database: Database
  input: string
}): Promise<ResolveAccountTargetResult> => {
  const target = parseAccountTarget(input)
  if (!target) return { type: 'invalid' }

  const gateValue = target.type === 'handle' ? target.domain : target.url
  if (!(await canFederateWithDomain(database, gateValue))) {
    return { type: 'forbidden' }
  }

  const signingActor = await getFederationSigningActorSafe(
    database,
    'for authorize interaction resolution'
  )

  if (target.type === 'handle') {
    return resolveHandle({
      database,
      username: target.username,
      domain: target.domain,
      acct: target.acct,
      signingActor
    })
  }

  // A known id (local actors included) resolves with no outbound request.
  const knownActor = await database.getActorFromId({ id: target.url })
  if (knownActor) return { type: 'resolved', actor: knownActor }

  const profileHandle = parseProfileUrlAccountHandle(target.url)
  if (profileHandle) {
    return resolveHandle({
      database,
      username: profileHandle.username,
      domain: profileHandle.domain,
      acct: `${profileHandle.username}@${profileHandle.domain}`,
      signingActor
    })
  }

  const person = await getActorPerson({ actorId: target.url, signingActor })
  if (!person) return { type: 'not-found' }

  const canonicalActorId = normalizeActorId(person.id)
  if (!canonicalActorId) return { type: 'not-found' }

  if (!(await canFederateWithDomain(database, canonicalActorId))) {
    return { type: 'forbidden' }
  }

  const actor = await recordRemoteActorBestEffort({
    actorId: canonicalActorId,
    database,
    signingActor
  })
  return actor ? { type: 'resolved', actor } : { type: 'not-found' }
}
