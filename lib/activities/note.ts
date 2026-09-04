import { z } from 'zod'

import { normalizeLanguageCode } from '@/lib/services/translation/types'
import {
  ArticleContent,
  type Attachment,
  Document,
  ImageContent,
  KnownTag,
  Note,
  PageContent,
  Question,
  type Tag,
  VideoContent
} from '@/lib/types/activitypub'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'

export type BaseNote =
  Note | ImageContent | PageContent | ArticleContent | VideoContent | Question

export const BaseNoteSchema = z.union([
  Note,
  ImageContent,
  PageContent,
  ArticleContent,
  VideoContent,
  Question
])

type UrlValue =
  | string
  | { href?: unknown; [key: string]: unknown }
  | (string | { href?: unknown; [key: string]: unknown })[]
  | null
  | undefined

export const getUrl = (url: UrlValue): string | undefined => {
  if (!url) return undefined
  if (Array.isArray(url)) {
    const first = url[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object' && typeof first.href === 'string') {
      return first.href
    }
    return undefined
  }
  if (typeof url === 'string') return url
  if (typeof url === 'object' && typeof url.href === 'string') {
    return url.href
  }
  return undefined
}

type ReplyValue = string | { id?: string } | null | undefined

export const getReply = (reply: ReplyValue): string | undefined => {
  if (typeof reply === 'string') return reply
  return reply?.id
}

/**
 * Resolve the quoted status id from a note's quote fields, following FEP-044f
 * precedence: `quote` (a bare id string or an embedded `{ id }` object) →
 * `quoteUrl` (Mastodon) → `quoteUri` (Fedibird) → `_misskey_quote` (Misskey).
 * Returns null when the note quotes nothing.
 */
export const getQuoteTargetId = (object: BaseNote): string | null => {
  const { quote } = object
  if (typeof quote === 'string' && quote) return quote
  if (quote && typeof quote === 'object' && typeof quote.id === 'string') {
    return quote.id
  }
  return object.quoteUrl || object.quoteUri || object._misskey_quote || null
}

const resolveIconUrl = (icon: unknown): string | null => {
  if (!icon) return null
  if (typeof icon === 'string') return icon
  if (typeof icon === 'object') {
    const rec = icon as { url?: unknown; href?: unknown }
    if (typeof rec.url === 'string') return rec.url
    if (
      typeof rec.url === 'object' &&
      rec.url !== null &&
      typeof (rec.url as { href?: unknown }).href === 'string'
    ) {
      return (rec.url as { href: string }).href
    }
    if (typeof rec.href === 'string') return rec.href
  }
  return null
}

const isDocument = (attachment: Attachment): attachment is Document =>
  Document.safeParse(attachment).success

export const getAttachments = (object: BaseNote): Document[] => {
  const attachments: Document[] = []
  if (object.attachment) {
    const list = Array.isArray(object.attachment)
      ? object.attachment
      : [object.attachment]
    // Keep only Document attachments; other/unknown attachment kinds (tolerated
    // as loose objects by the schema) are not media and are dropped here.
    attachments.push(...list.filter(isDocument))
  }

  if (['Image', 'Video'].includes(object.type)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsafeObject = object as any
    let url = getUrl(unsafeObject.url)
    let mediaType =
      unsafeObject.mediaType ||
      (object.type === 'Image' ? 'image/jpeg' : 'video/mp4')
    let width = unsafeObject.width
    let height = unsafeObject.height
    let thumbnailUrl: string | null = null

    if (object.type === 'Video') {
      if (Array.isArray(unsafeObject.url)) {
        type VideoLink = {
          mediaType?: string
          href?: string
          width?: number
          height?: number
        }

        const parseVideoLink = (u: unknown): VideoLink | null => {
          if (typeof u === 'string') {
            return { href: u }
          }
          if (typeof u === 'object' && u !== null) {
            const rawHref = (u as { href?: unknown }).href
            const rawMediaType = (u as { mediaType?: unknown }).mediaType
            const rawWidth = (u as { width?: unknown }).width
            const rawHeight = (u as { height?: unknown }).height
            return {
              href: typeof rawHref === 'string' ? rawHref : undefined,
              mediaType:
                typeof rawMediaType === 'string' ? rawMediaType : undefined,
              width: typeof rawWidth === 'number' ? rawWidth : undefined,
              height: typeof rawHeight === 'number' ? rawHeight : undefined
            }
          }
          return null
        }

        const isDirectVideo = (link: VideoLink) => {
          const mt = (link.mediaType || '').toLowerCase()
          const href = (link.href || '').toLowerCase()
          return (
            mt.startsWith('video/') || /\.(mp4|webm|ogv)(?:[?#]|$)/i.test(href)
          )
        }

        const isHlsVideo = (link: VideoLink) => {
          const mt = (link.mediaType || '').toLowerCase()
          const href = (link.href || '').toLowerCase()
          return mt.includes('mpegurl') || /\.m3u8(?:[?#]|$)/i.test(href)
        }

        const parsedLinks = (unsafeObject.url as unknown[])
          .map(parseVideoLink)
          .filter((link): link is VideoLink => Boolean(link && link.href))

        const directLink = parsedLinks.find(isDirectVideo)
        const hlsLink = parsedLinks.find(isHlsVideo)
        const videoLink = directLink ?? hlsLink

        if (videoLink && videoLink.href) {
          url = videoLink.href
          if (videoLink.mediaType) {
            mediaType = videoLink.mediaType
          }
          if (typeof videoLink.width === 'number') width = videoLink.width
          if (typeof videoLink.height === 'number') height = videoLink.height
        } else {
          url = undefined
        }
      }

      // PeerTube video objects have mediaType: 'text/markdown' for the description.
      // If mediaType is not a video type, default to 'video/mp4'.
      if (!mediaType || !mediaType.startsWith('video/')) {
        mediaType = 'video/mp4'
      }

      if (unsafeObject.icon) {
        if (Array.isArray(unsafeObject.icon)) {
          thumbnailUrl = resolveIconUrl(unsafeObject.icon[0])
        } else {
          thumbnailUrl = resolveIconUrl(unsafeObject.icon)
        }
      }
    }

    if (url && !attachments.some((a) => a.url === url)) {
      attachments.push({
        type: 'Document',
        mediaType,
        url,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        name: unsafeObject.name,
        width: typeof width === 'number' ? width : undefined,
        height: typeof height === 'number' ? height : undefined,
        blurhash: unsafeObject.blurhash,
        ...(unsafeObject.focalPoint
          ? { focalPoint: unsafeObject.focalPoint }
          : {})
      })
    }
  }
  return attachments
}

const isKnownTag = (tag: Tag): tag is KnownTag =>
  KnownTag.safeParse(tag).success

export const getTags = (object: BaseNote): KnownTag[] => {
  if (!object.tag) return []
  const tags = Array.isArray(object.tag) ? object.tag : [object.tag]
  // Keep only fully-valid known tags. Unknown/future or malformed tag kinds
  // (which the schema now tolerates as loose objects so they don't reject the
  // whole note) are dropped here, so consumers get guaranteed tag shapes.
  return tags.filter(isKnownTag)
}

export const getContent = (object: BaseNote) => {
  let content = ''
  if (object.content) {
    // Wordpress uses array in contentMap instead of locale map.
    // This is a temporary fixed to support it.
    if (Array.isArray(object.content)) {
      content = object.content[0]
    } else {
      content = object.content
    }
  } else if (object.contentMap) {
    if (Array.isArray(object.contentMap)) {
      content = object.contentMap[0]
    } else {
      const keys = Object.keys(object.contentMap)
      if (keys.length > 0) {
        content = object.contentMap[keys[0]]
      }
    }
  }

  if (
    object.type === 'Video' &&
    'name' in object &&
    typeof object.name === 'string' &&
    object.name.trim()
  ) {
    const title = escapeHtml(object.name.trim())
    const titleHeader = `<p><strong>${title}</strong></p>`
    if (!content.startsWith(titleHeader)) {
      return content ? `${titleHeader}\n${content}` : titleHeader
    }
  }

  return content
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
