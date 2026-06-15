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

export const normalizeActorId = (actorId: string | null | undefined) =>
  normalizeActivityPubUri(actorId?.split('#')[0])

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

export const normalizeActivityPubAnnounce = (data: unknown) => {
  if (!isRecord(data)) return data
  return {
    ...data,
    type: normalizeActivityPubType(data.type) ?? data.type,
    actor: extractActivityPubId(data.actor) ?? data.actor,
    object: extractActivityPubId(data.object) ?? data.object,
    to: normalizeActivityPubRecipients(data.to) ?? data.to,
    cc: normalizeActivityPubRecipients(data.cc) ?? data.cc
  }
}

export const normalizeActivityPubContent = (data: unknown) => {
  if (!isRecord(data)) return data
  return {
    ...data,
    type: normalizeActivityPubType(data.type) ?? data.type,
    attributedTo: extractActivityPubId(data.attributedTo) ?? data.attributedTo,
    inReplyTo: extractActivityPubId(data.inReplyTo) ?? data.inReplyTo,
    url: extractActivityPubId(data.url) ?? data.url,
    to: normalizeActivityPubRecipients(data.to) ?? data.to,
    cc: normalizeActivityPubRecipients(data.cc) ?? data.cc
  }
}
