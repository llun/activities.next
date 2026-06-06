import { isRecord } from '@/lib/utils/typeGuards'

export const normalizeActivityPubUri = (uri: string | null | undefined) => {
  if (!uri) return null

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

export const extractActivityPubId = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractActivityPubId(item)
      if (id) return id
    }
    return
  }
  if (!isRecord(value)) return
  if (typeof value.id === 'string') return value.id
  if (typeof value.href === 'string') return value.href
  if (typeof value.url === 'string') return value.url
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

/**
 * Coerces an ActivityPub `to`/`cc` value into a string array: a single
 * recipient is wrapped, and empty or non-string entries are dropped. Mirrors the
 * inline normalization used when persisting inbound notes/polls/announces.
 */
export const toRecipientArray = (
  value: string | string[] | undefined | null
): string[] =>
  Array.isArray(value)
    ? value
    : [value].filter(
        (item): item is string => typeof item === 'string' && item !== ''
      )

export const normalizeActivityPubAnnounce = (data: unknown) => {
  if (!isRecord(data)) return data
  return {
    ...data,
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
    attributedTo: extractActivityPubId(data.attributedTo) ?? data.attributedTo,
    inReplyTo: extractActivityPubId(data.inReplyTo) ?? data.inReplyTo,
    url: extractActivityPubId(data.url) ?? data.url,
    to: normalizeActivityPubRecipients(data.to) ?? data.to,
    cc: normalizeActivityPubRecipients(data.cc) ?? data.cc
  }
}
