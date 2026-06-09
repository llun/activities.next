import { normalizeLanguageCode } from '@/lib/services/translation/types'
import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  VideoContent
} from '@/lib/types/activitypub'

export type BaseNote =
  | Note
  | ImageContent
  | PageContent
  | ArticleContent
  | VideoContent

type UrlValue = string | { href?: string } | (string | { href?: string })[]

export const getUrl = (url: UrlValue): string | undefined => {
  if (Array.isArray(url)) {
    const first = url[0]
    if (typeof first === 'string') return first
    return first?.href
  }
  if (typeof url === 'string') return url
  return url?.href
}

type ReplyValue = string | { id?: string } | null | undefined

export const getReply = (reply: ReplyValue): string | undefined => {
  if (typeof reply === 'string') return reply
  return reply?.id
}

export const getAttachments = (object: BaseNote) => {
  const attachments = []
  if (object.attachment) {
    if (Array.isArray(object.attachment)) {
      attachments.push(...object.attachment)
    } else {
      attachments.push(object.attachment)
    }
  }

  if (['Image', 'Video'].includes(object.type)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsafeObject = object as any
    const url = getUrl(unsafeObject.url)
    if (url) {
      attachments.push({
        type: 'Document',
        mediaType:
          unsafeObject.mediaType ||
          (object.type === 'Image' ? 'image/jpeg' : 'video/mp4'),
        url,
        name: unsafeObject.name,
        width: unsafeObject.width,
        height: unsafeObject.height,
        blurhash: unsafeObject.blurhash
      })
    }
  }
  return attachments
}

export const getTags = (object: BaseNote) => {
  if (!object.tag) return []
  if (Array.isArray(object.tag)) return object.tag
  return [object.tag]
}

export const getContent = (object: BaseNote) => {
  if (object.content) {
    // Wordpress uses array in contentMap instead of locale map.
    // This is a temporary fixed to support it.
    if (Array.isArray(object.content)) {
      return object.content[0]
    }
    return object.content
  }

  if (object.contentMap) {
    if (Array.isArray(object.contentMap)) {
      return object.contentMap[0]
    }

    const keys = Object.keys(object.contentMap)
    if (keys.length === 0) return ''

    const key = Object.keys(object.contentMap)[0]
    return object.contentMap[key]
  }
  return ''
}

const firstLocaleKey = (
  map: Record<string, string> | string[] | null | undefined
): string | undefined => {
  // Only locale-keyed objects encode a language; the array/Wordpress shape
  // carries no locale information. Guard against malformed AP payloads where
  // `map` is a non-object primitive at runtime (`typeof null === 'object'`).
  if (!map || typeof map !== 'object' || Array.isArray(map)) return undefined
  return Object.keys(map)[0]
}

/**
 * Resolves the ISO 639-1 language of an incoming AP object. ActivityPub encodes
 * the language as the key of `contentMap` (e.g. `{ "th": "<p>…</p>" }`), so we
 * read the first locale key, falling back to `summaryMap`. Returns `null` when
 * nothing is resolvable or when `contentMap` is the array/Wordpress shape, which
 * carries no locale information.
 *
 * This only works at ingestion time: the persisted status content blob keeps
 * only the rendered fields and not the original `contentMap`, so the language of
 * statuses federated before this helper existed cannot be recovered after the
 * fact (they stay `language: null` until re-fetched or federated again).
 */
export const getLanguage = (object: BaseNote): string | null => {
  const localeKey =
    firstLocaleKey(object.contentMap) ?? firstLocaleKey(object.summaryMap)
  if (!localeKey) return null
  // Take the primary subtag (drop any regional suffix like "en-US"/"en_US")
  // and validate its length *before* normalizing. `normalizeLanguageCode`
  // truncates to two chars, which would silently turn a 3-letter ISO 639-2/3
  // code (e.g. "fil" → "fi", "ast" → "as") into the wrong language; checking
  // the length first rejects those instead, while we still reuse the shared
  // normalizer for the final lower-casing. Also rejects malformed keys
  // ("12", "!@", "a").
  const primarySubtag = localeKey.trim().split(/[-_]/)[0]
  if (!/^[a-z]{2}$/i.test(primarySubtag)) return null
  return normalizeLanguageCode(primarySubtag)
}

export const getSummary = (object: BaseNote) => {
  if (object.summary) return object.summary
  if (object.summaryMap) {
    const keys = Object.keys(object.summaryMap)
    if (keys.length === 0) return ''

    const key = Object.keys(object.summaryMap)[0]
    return object.summaryMap[key]
  }
  return ''
}
