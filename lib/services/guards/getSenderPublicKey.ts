import { z } from 'zod'

import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { isActivityPubDocumentResponse } from '@/lib/activities/activityPubResponse'
import { confirmActorHandle } from '@/lib/activities/confirmActorHandle'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor } from '@/lib/types/activitypub'
import {
  normalizeActivityPubUri,
  normalizeActorId
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'
import { isRecord } from '@/lib/utils/typeGuards'

const PublicKeyDocument = z
  .object({
    id: z.string(),
    owner: z.string(),
    publicKeyPem: z.string()
  })
  .passthrough()

export type SenderPublicKeyDetails = {
  owner: string | null
  publicKey: string
}

type ParsedSenderPublicKey =
  | {
      type: 'actor'
      actorId: string
      username: string
      webfinger?: string
      keyId: string
      requiresOwnerValidation: boolean
      details: SenderPublicKeyDetails
    }
  | {
      type: 'publicKey'
      keyId: string
      details: SenderPublicKeyDetails
    }

const EMPTY_PUBLIC_KEY_DETAILS: SenderPublicKeyDetails = {
  owner: null,
  publicKey: ''
}

const getLocalSenderPublicKeyDetails = async (
  database: Database,
  actorId: string
) => {
  const localActor = await database.getActorFromId({ id: actorId })
  if (localActor) {
    return {
      owner: localActor.id,
      publicKey: localActor.publicKey
    }
  }

  const actorIdWithoutFragment = normalizeActorId(actorId)
  if (!actorIdWithoutFragment || actorIdWithoutFragment === actorId) {
    return null
  }

  const fragmentLocalActor = await database.getActorFromId({
    id: actorIdWithoutFragment
  })
  if (!fragmentLocalActor) return null

  return {
    owner: fragmentLocalActor.id,
    publicKey: fragmentLocalActor.publicKey
  }
}

const parseJsonBody = ({ body, keyId }: { body: string; keyId: string }) => {
  try {
    return JSON.parse(body) as unknown
  } catch (error) {
    logger.warn({
      err: error as Error,
      keyId,
      message: 'Unable to parse sender public key response'
    })
    return null
  }
}

// An actor publishing several keys is read as the key the signature names, so
// a request signed with a non-default key still resolves. With no matching
// entry the array is left for the schema's default pick. Ownership is checked
// afterwards exactly as for a single key.
const narrowPublicKeyToKeyId = (json: unknown, selectKeyId: string) => {
  if (!isRecord(json) || !Array.isArray(json.publicKey)) return json
  const normalizedSelectKeyId = normalizeActivityPubUri(selectKeyId)
  if (!normalizedSelectKeyId) return json

  const matching = json.publicKey.find(
    (entry) =>
      isRecord(entry) &&
      typeof entry.id === 'string' &&
      normalizeActivityPubUri(entry.id) === normalizedSelectKeyId
  )
  return matching ? { ...json, publicKey: matching } : json
}

const parseSenderPublicKey = ({
  body,
  keyId,
  selectKeyId
}: {
  body: string
  keyId: string
  selectKeyId?: string
}): ParsedSenderPublicKey | null => {
  const json = parseJsonBody({ body, keyId })
  if (!json) return null

  const actor = Actor.safeParse(
    narrowPublicKeyToKeyId(json, selectKeyId ?? keyId)
  )
  const normalizedKeyId = normalizeActivityPubUri(keyId)
  const normalizedKeyOwner = normalizeActorId(keyId)
  if (!normalizedKeyId || !normalizedKeyOwner) return null

  if (actor.success) {
    const normalizedActorId = normalizeActorId(actor.data.id)
    const normalizedActorPublicKeyId = normalizeActivityPubUri(
      actor.data.publicKey.id
    )
    const normalizedPublicKeyOwner = normalizeActorId(
      actor.data.publicKey.owner
    )
    if (
      !normalizedActorId ||
      !normalizedActorPublicKeyId ||
      normalizedActorId !== normalizedPublicKeyOwner
    ) {
      return null
    }

    if (
      normalizedActorId !== normalizedKeyOwner &&
      normalizedActorPublicKeyId !== normalizedKeyId
    ) {
      return null
    }

    return {
      type: 'actor',
      actorId: actor.data.id,
      username: actor.data.preferredUsername,
      webfinger: actor.data.webfinger,
      keyId: actor.data.publicKey.id,
      requiresOwnerValidation: normalizedActorId !== normalizedKeyOwner,
      details: {
        owner: actor.data.id,
        publicKey: actor.data.publicKey.publicKeyPem
      }
    }
  }

  const publicKeyDocument = PublicKeyDocument.safeParse(json)
  if (!publicKeyDocument.success) return null
  if (normalizeActivityPubUri(publicKeyDocument.data.id) !== normalizedKeyId) {
    return null
  }

  return {
    type: 'publicKey',
    keyId: publicKeyDocument.data.id,
    details: {
      owner: publicKeyDocument.data.owner,
      publicKey: publicKeyDocument.data.publicKeyPem
    }
  }
}

// The key fetch runs inside an UNAUTHENTICATED inbox request, before the
// signature is verified, against a host the sender chose via `keyId`. With the
// shared defaults (10 s timeout plus a backed-off retry, and up to three more
// sequential fetches for owner validation and the 410 fallback) a sender
// pointing `keyId` at a slow host held each inbox request open for tens of
// seconds. A peer that cannot serve its key quickly gets a 401, which Mastodon
// and friends retry later anyway. The WebFinger lookup that confirms an
// unknown signer's handle runs on the same budget.
const SENDER_KEY_FETCH_TIMEOUT_MS = 3000

const fetchSenderPublicKey = async (
  actorId: string,
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>,
  selectKeyId?: string
) => {
  const response = await request({
    url: actorId,
    headers: ({ url }) =>
      activityPubRequestHeaders({
        url: url.toString(),
        signingActor
      }),
    numberOfRetry: 0,
    responseTimeout: SENDER_KEY_FETCH_TIMEOUT_MS,
    // The document is trusted because the keyId's origin served it (its id
    // must equal the requested one). A hop onto another host would let that
    // host — never checked against domain blocks — mint the sender's key.
    allowCrossHostRedirects: false
  })
  // The keyId names any URL on the sender's origin, and a user upload there
  // (served as `application/json`) could otherwise mint a signing key.
  if (!isActivityPubDocumentResponse(response, actorId)) {
    return {
      document: null,
      statusCode: response.statusCode
    }
  }

  return {
    document: parseSenderPublicKey({
      body: response.body,
      keyId: actorId,
      selectKeyId
    }),
    statusCode: response.statusCode
  }
}

const validateOwnerActorKey = async (
  {
    keyId,
    owner,
    publicKey
  }: {
    keyId: string
    owner: string | null
    publicKey: string
  },
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>,
  database: Database
) => {
  if (!owner) return null
  const normalizedOwner = normalizeActorId(owner)
  const normalizedKeyId = normalizeActivityPubUri(keyId)
  if (!normalizedOwner || !normalizedKeyId) return null
  if (!(await canFederateWithDomain(database, normalizedOwner))) return null

  const ownerResponse = await fetchSenderPublicKey(
    normalizedOwner,
    signingActor,
    keyId
  )
  if (ownerResponse.statusCode !== 200) return null
  if (ownerResponse.document?.type !== 'actor') return null

  const ownerDocument = ownerResponse.document
  if (normalizeActorId(ownerDocument.actorId) !== normalizedOwner) return null
  if (normalizeActivityPubUri(ownerDocument.keyId) !== normalizedKeyId) {
    return null
  }
  if (ownerDocument.details.publicKey !== publicKey) {
    return null
  }

  return {
    owner: ownerDocument.actorId,
    username: ownerDocument.username,
    webfinger: ownerDocument.webfinger,
    publicKey
  }
}

const resolveFetchedPublicKey = async (
  document: ParsedSenderPublicKey | null,
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>,
  database: Database
) => {
  if (!document) return null
  if (document.type === 'actor') {
    if (!document.requiresOwnerValidation) {
      return {
        owner: document.actorId,
        username: document.username,
        webfinger: document.webfinger,
        publicKey: document.details.publicKey
      }
    }
    return validateOwnerActorKey(
      {
        keyId: document.keyId,
        owner: document.actorId,
        publicKey: document.details.publicKey
      },
      signingActor,
      database
    )
  }

  return validateOwnerActorKey(
    {
      keyId: document.keyId,
      owner: document.details.owner,
      publicKey: document.details.publicKey
    },
    signingActor,
    database
  )
}

const isKnownKeyOwner = async (database: Database, owner: string) => {
  if (await database.getActorFromId({ id: owner })) return true
  const relayActorId = normalizeActorId(owner)
  if (!relayActorId) return false
  // Not `getRelayByActorId`: the id is not unique (an unsubscribed row keeps
  // it), and an idle row returned first would send the relay to WebFinger.
  const relays = await database.getAcceptedRelays()
  return relays.some((relay) => relay.actorId === relayActorId)
}

const fetchSenderPublicKeyDetails = async (
  actorId: string,
  signingActor: Awaited<ReturnType<typeof getFederationSigningActor>>,
  database: Database
) => {
  const response = await fetchSenderPublicKey(actorId, signingActor)
  const resolved = await resolveFetchedPublicKey(
    response.document,
    signingActor,
    database
  )
  // A key from a sender with no stored row is accepted only once WebFinger
  // confirms the owner's handle, as Mastodon does before trusting an unknown
  // signer. The content-type gate alone leaves any host that serves user bytes
  // as ActivityPub able to sign as a URL there, and a status from a signer
  // with no row still renders under that host's name. An owner that already
  // has a row holds its handle there and is not asked again: a `#main-key`
  // keyId is answered from the row before any fetch, but a path-based one
  // (GoToSocial's `/users/x/main-key`) is fetched on every request and would
  // otherwise pay a WebFinger lookup each time. An accepted relay is known the
  // same way: its actor never gets a row, only the relay subscription's
  // `actorId`, recorded from an Accept whose signer passed this check.
  const isConfirmed =
    resolved !== null &&
    ((await isKnownKeyOwner(database, resolved.owner)) ||
      (await confirmActorHandle({
        database,
        actorId: resolved.owner,
        username: resolved.username,
        webfinger: resolved.webfinger,
        withNetworkRetry: false,
        responseTimeout: SENDER_KEY_FETCH_TIMEOUT_MS,
        // Like the key fetch: this runs before the signature is verified, and
        // a hop would send the request to a host no domain block was checked
        // against. The lookups go to the owner's own host and, failing that,
        // to the handle domain its `webfinger` property or its host's
        // `subject` names, which `confirmActorHandle` checks against the
        // federation policy first, so a split-domain deployment still
        // confirms without one.
        allowCrossHostRedirects: false
      })) !== null)
  return {
    details: isConfirmed
      ? { owner: resolved.owner, publicKey: resolved.publicKey }
      : null,
    statusCode: response.statusCode
  }
}

// A peer that rotates its key leaves the stored one stale until the periodic
// actor refresh (days). A request signed with the new key is retried once
// against a fresh fetch — but the fetch runs inside an UNAUTHENTICATED inbox
// request, so refreshes are throttled per owner, and the throttle is recorded
// before the fetch so a failing or slow peer cannot be made to cost a fetch per
// request either. In-memory and per process: a few extra fetches across
// instances are acceptable, a shared counter is not worth a table.
export const SENDER_KEY_REFRESH_MIN_INTERVAL_MS = 5 * 60_000
const KEY_REFRESH_ATTEMPTS_MAX = 1000
const keyRefreshAttempts = new Map<string, number>()

export const resetSenderKeyRefreshAttempts = () => keyRefreshAttempts.clear()

const reserveKeyRefreshAttempt = (owner: string, now: number) => {
  const lastAttempt = keyRefreshAttempts.get(owner)
  if (
    lastAttempt !== undefined &&
    now - lastAttempt < SENDER_KEY_REFRESH_MIN_INTERVAL_MS
  ) {
    return false
  }
  if (keyRefreshAttempts.size >= KEY_REFRESH_ATTEMPTS_MAX) {
    keyRefreshAttempts.clear()
  }
  keyRefreshAttempts.set(owner, now)
  return true
}

// Re-fetches the key a failed signature named and returns it only when it can
// replace the stored one: same owner as the stale key, and different bytes.
// Never persists — the caller stores it once the request verifies with it.
export const refreshSenderPublicKeyDetails = async (
  database: Database,
  keyId: string,
  stale: SenderPublicKeyDetails
): Promise<SenderPublicKeyDetails | null> => {
  const owner = normalizeActorId(stale.owner)
  if (!owner || !stale.publicKey) return null

  try {
    const stored = await database.getActorFromId({ id: owner })
    // Local actors are the source of truth for their own keys, and a row
    // written moments ago was just refreshed by another path.
    if (!stored || stored.privateKey) return null
    const now = Date.now()
    if (now - stored.updatedAt < SENDER_KEY_REFRESH_MIN_INTERVAL_MS) return null
    if (!reserveKeyRefreshAttempt(owner, now)) return null

    const { details } = await fetchSenderPublicKeyDetails(
      keyId,
      await getFederationSigningActor(database),
      database
    )
    if (!details) return null
    if (normalizeActorId(details.owner) !== owner) return null
    if (details.publicKey === stale.publicKey) return null
    return details
  } catch (error) {
    logger.warn({
      err: toLoggableError(error),
      keyId,
      message: 'Unable to refresh sender public key'
    })
    return null
  }
}

// Called only after a request verified with the refreshed key.
export const persistRefreshedSenderPublicKey = async (
  database: Database,
  details: SenderPublicKeyDetails
) => {
  const actorId = normalizeActorId(details.owner)
  if (!actorId) return
  await database.updateActor({ actorId, publicKey: details.publicKey })
}

const resolveSenderPublicKeyDetails = async (
  database: Database,
  actorId: string
) => {
  const localPublicKey = await getLocalSenderPublicKeyDetails(database, actorId)
  if (localPublicKey) return localPublicKey

  const signingActor = await getFederationSigningActor(database)
  const response = await fetchSenderPublicKeyDetails(
    actorId,
    signingActor,
    database
  )
  if (response.details) return response.details

  if (response.statusCode === 410) {
    const url = new URL(actorId)
    const fallbackResponse = await fetchSenderPublicKeyDetails(
      new URL('/actor#main-key', url).toString(),
      signingActor,
      database
    )
    return fallbackResponse.details ?? EMPTY_PUBLIC_KEY_DETAILS
  }

  return EMPTY_PUBLIC_KEY_DETAILS
}

export async function getSenderPublicKeyDetails(
  database: Database,
  actorId: string
): Promise<SenderPublicKeyDetails> {
  return withSpan('guard', 'getSenderPublicKey', { actorId }, async (span) => {
    try {
      return await resolveSenderPublicKeyDetails(database, actorId)
    } catch (error) {
      const nodeError = error as Error
      span.recordException(nodeError)
      logger.warn({
        actorId,
        err: nodeError,
        message: 'Unable to resolve sender public key'
      })
      return EMPTY_PUBLIC_KEY_DETAILS
    }
  })
}

export async function getSenderPublicKey(database: Database, actorId: string) {
  const sender = await getSenderPublicKeyDetails(database, actorId)
  return sender.publicKey
}
