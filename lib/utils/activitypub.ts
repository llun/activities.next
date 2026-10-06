import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { isRecord } from '@/lib/utils/typeGuards'

// JSON-LD blank node identifiers (`_:b0`, `_:foo`) are document-local artifacts
// of the JSON-LD processor and are never valid, resolvable ActivityPub ids.
const isBlankNodeId = (value: string) => value.startsWith('_:')

export const normalizeActivityPubUri = (uri: string | null | undefined) => {
  if (!uri) return null
  if (isBlankNodeId(uri)) return null

  try {
    const url = new URL(uri)
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()
    return url.toString()
  } catch {
    return uri
  }
}

/**
 * Do two ActivityPub ids live on the same origin?
 *
 * This is the trust boundary for "a document I fetched claims an id" — the same
 * question `sameHost`/`sameAuthority` answer inline in `processForwardedActivityJob`,
 * `verifyRemoteQuote`, `persistInboundQuoteEdge` and both quote-request actions
 * (those five copies should collapse onto this one in the dedup pass). A server
 * may legitimately canonicalise a URL WITHIN its own origin — this instance's own
 * `proxy.ts` serves the ActivityPub document for `/@user/<id>` with an `id` of
 * `/users/<user>/statuses/<n>`, and Mastodon does the same — so an exact id match
 * is too strict. What must never be allowed is a document claiming an id on
 * ANOTHER host, which is how a hostile server names someone else's status.
 *
 * Fails CLOSED, and the empty-host test is the load-bearing half of that. A
 * blank node or an unparseable id throws, but a HOST-LESS URI parses fine and
 * reports `host === ''` — so `urn:`, `did:`, `tag:` and `mailto:` ids all
 * compare equal to one another under a bare `.host` comparison, which is the
 * one way two unrelated ids can be read as the same authority.
 *
 * It is defence in depth at every call site that exists today, and the reason
 * is the same one everywhere: an https-only fetch stands between the attacker
 * and the comparison. On the announce path `getNote` returns null first;
 * `verifyRemoteQuote`'s post-fetch pair and `handleQuoteRequest` both sit
 * behind `fetchQuoteAuthorization`; `processForwardedActivityJob` gates both
 * operands on `isHttpUrl`; and the pre-fetch comparisons in
 * `verifyQuoteAuthorizationStamp` and `handleQuoteResponse` take their second
 * operand from a signature keyId actor, which always has a host. The one place
 * a host-less pair could chain into a write is `persistInboundQuoteEdge`, and
 * only against a status stored under a host-less id — which nothing produces
 * except the unconstrained fetched-`note.id` writes AGENTS.md records as open.
 * Do not read any of that as "so it does not matter": it is the shape of the
 * bug, and the copies it replaces have no such test. Deliberately stricter than
 * those five on exactly this input and no other.
 */
export const isSameActivityPubOrigin = (
  first: string | null | undefined,
  second: string | null | undefined
): boolean => {
  if (!first || !second) return false
  try {
    const host = new URL(first).host
    return host !== '' && host === new URL(second).host
  } catch {
    return false
  }
}

export const normalizeActorId = (
  actorId: string | null | undefined
): string | null => {
  const withoutFragment = actorId?.split('#')[0]
  const normalized = normalizeActivityPubUri(withoutFragment)
  if (!normalized) return null
  return normalized.replace(/\/+$/, '')
}

export const actorIdsMatch = (
  firstActorId: string | null | undefined,
  secondActorId: string | null | undefined
): boolean => {
  const normalizedFirstActorId = normalizeActorId(firstActorId)
  const normalizedSecondActorId = normalizeActorId(secondActorId)

  return (
    Boolean(normalizedFirstActorId) &&
    normalizedFirstActorId === normalizedSecondActorId
  )
}

const ACTIVITY_STREAMS_NAMESPACE = 'https://www.w3.org/ns/activitystreams#'

/**
 * Canonicalises a JSON-LD `type` value to a bare term. `type` may legitimately
 * arrive as an array, a compact CURIE (`as:Note`) or a fully expanded IRI
 * (`https://www.w3.org/ns/activitystreams#Note`); all collapse to `Note`. This
 * mirrors what JSON-LD compaction does and is used as a fallback for inputs
 * that were not compacted (for example when compaction failed).
 */
export const normalizeActivityPubType = (
  value: unknown
): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return undefined
  if (raw.startsWith(ACTIVITY_STREAMS_NAMESPACE)) {
    return raw.slice(ACTIVITY_STREAMS_NAMESPACE.length)
  }
  if (raw.startsWith('as:')) return raw.slice('as:'.length)
  return raw
}

export const extractActivityPubId = (value: unknown): string | undefined => {
  if (typeof value === 'string') return isBlankNodeId(value) ? undefined : value
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractActivityPubId(item)
      if (id) return id
    }
    return
  }
  if (!isRecord(value)) return
  if (typeof value.id === 'string') return extractActivityPubId(value.id)
  if (typeof value.href === 'string') return extractActivityPubId(value.href)
  if (typeof value.url === 'string') return extractActivityPubId(value.url)
  return
}

export const normalizeActivityPubRecipients = (
  value: unknown
): string | string[] | undefined => {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => extractActivityPubId(item))
      .filter((item): item is string => Boolean(item))
    return items.length ? items : undefined
  }
  return extractActivityPubId(value)
}

// JSON-LD compaction emits the public collection as the compact alias
// `as:Public`; persist it as the full IRI so stored recipients have one
// canonical form (matching locally-authored statuses).
const canonicalizePublicRecipient = (recipient: string) =>
  recipient === ACTIVITY_STREAM_PUBLIC_COMPACT
    ? ACTIVITY_STREAM_PUBLIC
    : recipient

/**
 * Coerces an ActivityPub `to`/`cc` value into a string array: a single
 * recipient is wrapped, and empty or non-string entries are dropped. Mirrors the
 * inline normalization used when persisting inbound notes/polls/announces.
 */
export const toRecipientArray = (
  value: string | string[] | undefined | null
): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter((item): item is string => typeof item === 'string' && item !== '')
    .map(canonicalizePublicRecipient)

// A FEP-1b12 group (a Lemmy community, an Mbin magazine) does not boost a post:
// it announces the author's whole `Create` activity. The boosted post is that
// activity's object, so read the id from there rather than boosting the
// activity id, which no note fetch can resolve. Only the id is taken; the
// post itself is still fetched from its own origin.
const getAnnouncedObject = (object: unknown) =>
  isRecord(object) &&
  normalizeActivityPubType(object.type) === 'Create' &&
  object.object
    ? object.object
    : object

export const normalizeActivityPubAnnounce = (data: unknown) => {
  if (!isRecord(data)) return data
  const object = getAnnouncedObject(data.object)
  return {
    ...data,
    type: normalizeActivityPubType(data.type) ?? data.type,
    actor: extractActivityPubId(data.actor) ?? data.actor,
    object: extractActivityPubId(object) ?? object,
    to: normalizeActivityPubRecipients(data.to) ?? data.to,
    cc: normalizeActivityPubRecipients(data.cc) ?? data.cc
  }
}

const toIdList = (value: unknown): string[] => {
  const normalized = normalizeActivityPubRecipients(value)
  if (Array.isArray(normalized)) return normalized
  return normalized ? [normalized] : []
}

// Lemmy, Mbin and Kbin name the community (a `Group`) a post belongs to in
// `audience` (FEP-1b12). Some of them leave it out of `to`/`cc`, so fold it
// into `cc` to keep the community on the stored recipients. Only plain actor
// ids are folded: the public collection or a followers collection named as
// `audience` would widen the post's visibility, so those are ignored. `cc` is
// returned untouched when there is no audience to add.
const mergeAudienceIntoCc = (
  to: unknown,
  cc: unknown,
  audience: unknown
): unknown => {
  const audienceIds = toIdList(audience).filter(
    (id) =>
      id !== ACTIVITY_STREAM_PUBLIC &&
      id !== ACTIVITY_STREAM_PUBLIC_COMPACT &&
      id !== 'Public' &&
      !id.endsWith('/followers')
  )
  if (audienceIds.length === 0) return cc
  const existing = new Set([...toIdList(to), ...toIdList(cc)])
  const missing = audienceIds.filter((id) => !existing.has(id))
  if (missing.length === 0) return cc
  return [...toIdList(cc), ...new Set(missing)]
}

export const normalizeActivityPubContent = (data: unknown) => {
  if (!isRecord(data)) return data
  const isVideoOrComplexUrl =
    Array.isArray(data.url) &&
    (data.type === 'Video' ||
      data.url.some((u) => {
        if (typeof u === 'string') {
          return /\.(mp4|m3u8|webm|ogv)(?:[?#]|$)/i.test(u)
        }
        if (typeof u === 'object' && u !== null) {
          const rawMt =
            (u as { mediaType?: unknown }).mediaType ||
            (u as { mimeType?: unknown }).mimeType
          const mt = typeof rawMt === 'string' ? rawMt.toLowerCase() : ''
          const rawHref = (u as { href?: unknown }).href
          const href = typeof rawHref === 'string' ? rawHref.toLowerCase() : ''
          return (
            mt.startsWith('video/') ||
            mt.includes('mpegurl') ||
            /\.(mp4|m3u8|webm|ogv)(?:[?#]|$)/i.test(href)
          )
        }
        return false
      }))

  return {
    ...data,
    type: normalizeActivityPubType(data.type) ?? data.type,
    attributedTo: extractActivityPubId(data.attributedTo) ?? data.attributedTo,
    inReplyTo: extractActivityPubId(data.inReplyTo) ?? data.inReplyTo,
    url: isVideoOrComplexUrl
      ? data.url
      : (extractActivityPubId(data.url) ?? data.url),
    to: normalizeActivityPubRecipients(data.to) ?? data.to,
    cc: mergeAudienceIntoCc(
      data.to,
      normalizeActivityPubRecipients(data.cc) ?? data.cc,
      data.audience
    )
  }
}
