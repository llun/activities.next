import { z } from 'zod'

import { MAX_STORED_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
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
import { isHttpUrl } from '@/lib/utils/isHttpUrl'
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

const getRawUrl = (url: UrlValue): string | undefined => {
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

// A remote object's `url` is a free-form string that ends up as a link target
// (status `url`, profile link, media url), so only http(s) survives: a
// `javascript:` or `data:` url resolves to undefined and callers fall back to
// the object id.
export const getUrl = (url: UrlValue): string | undefined => {
  const value = getRawUrl(url)
  return isHttpUrl(value) ? value : undefined
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
  const target =
    typeof quote === 'string' && quote
      ? quote
      : quote && typeof quote === 'object' && typeof quote.id === 'string'
        ? quote.id
        : object.quoteUrl || object.quoteUri || object._misskey_quote || null
  // A quote target is an ActivityPub object id, always http(s). Anything else
  // (`javascript:` and friends) is never persisted as a quote edge, since its
  // id is later rendered as the "RE:" fallback link.
  return isHttpUrl(target) ? target : null
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

// Mastodon sends every media attachment as `Document`, but the ActivityStreams
// vocabulary has dedicated media types and Pixelfed, Friendica, Funkwhale and
// others use them (`Image`, `Video`, `Audio`). All four are read the same way
// and stored as a Document; anything else (PropertyValue, Link, unknown kinds
// tolerated as loose objects by the schema) is not media and is dropped.
const MEDIA_ATTACHMENT_DEFAULT_TYPES: Record<string, string | null> = {
  Document: null,
  Image: 'image/jpeg',
  Video: 'video/mp4',
  Audio: 'audio/mpeg'
}

type AttachmentLink = { href: string; mediaType?: string }

const toAttachmentLink = (value: unknown): AttachmentLink | null => {
  if (typeof value === 'string') return { href: value }
  if (!value || typeof value !== 'object') return null
  const { href, mediaType } = value as { href?: unknown; mediaType?: unknown }
  if (typeof href !== 'string') return null
  return {
    href,
    ...(typeof mediaType === 'string' ? { mediaType } : {})
  }
}

// An attachment's `url` may be a bare string, a Link object, or an array of
// either (one Link per rendition). Prefer the first rendition whose mediaType
// matches the attachment's own kind, then any http(s) one.
const getAttachmentLink = (
  url: unknown,
  mediaPrefix: string | null
): AttachmentLink | null => {
  const links = (Array.isArray(url) ? url : [url])
    .map(toAttachmentLink)
    .filter((link): link is AttachmentLink => Boolean(link))
    .filter((link) => isHttpUrl(link.href))
  if (mediaPrefix) {
    const matching = links.find((link) =>
      link.mediaType?.toLowerCase().startsWith(mediaPrefix)
    )
    if (matching) return matching
  }
  return links[0] ?? null
}

const getStringMediaType = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined

const toMediaDocument = (attachment: Attachment): Document | null => {
  const record = attachment as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : ''
  // `hasOwn`, not `in`: a remote `type: 'constructor'` must not resolve to an
  // inherited Object.prototype member.
  if (!Object.hasOwn(MEDIA_ATTACHMENT_DEFAULT_TYPES, type)) return null
  if (type === 'Document') {
    const document = Document.safeParse(attachment)
    if (document.success) return document.data
  }

  const defaultMediaType = MEDIA_ATTACHMENT_DEFAULT_TYPES[type]
  const mediaPrefix = defaultMediaType
    ? `${defaultMediaType.split('/')[0]}/`
    : null
  const link = getAttachmentLink(record.url, mediaPrefix)
  if (!link) return null

  const recordMediaType = getStringMediaType(record.mediaType)
  let mediaType: string | undefined
  if (mediaPrefix) {
    // An Image/Video/Audio rendition explicitly typed as something else (an
    // HLS playlist, an HTML watch page) cannot play in the matching element.
    if (
      link.mediaType &&
      !link.mediaType.toLowerCase().startsWith(mediaPrefix)
    ) {
      return null
    }
    // The chosen rendition's own type describes the url actually stored.
    mediaType =
      link.mediaType ??
      (recordMediaType?.toLowerCase().startsWith(mediaPrefix)
        ? recordMediaType
        : undefined) ??
      defaultMediaType ??
      undefined
  } else {
    mediaType = recordMediaType ?? link.mediaType
  }
  if (!mediaType) return null

  // A Video attachment's poster frame arrives as `icon`, as on a top-level
  // Video object.
  const thumbnailUrl =
    typeof record.thumbnailUrl === 'string'
      ? record.thumbnailUrl
      : type === 'Video'
        ? resolveIconUrl(
            Array.isArray(record.icon) ? record.icon[0] : record.icon
          )
        : null

  const fields = {
    type: 'Document',
    mediaType,
    url: link.href,
    ...(thumbnailUrl && isHttpUrl(thumbnailUrl) ? { thumbnailUrl } : {}),
    name: typeof record.name === 'string' ? record.name : undefined,
    blurhash: typeof record.blurhash === 'string' ? record.blurhash : undefined,
    width: typeof record.width === 'number' ? record.width : undefined,
    height: typeof record.height === 'number' ? record.height : undefined
  }
  // A malformed focalPoint must not cost the attachment itself.
  const document =
    Document.safeParse({ ...fields, focalPoint: record.focalPoint }).data ??
    Document.safeParse(fields).data
  return document ?? null
}

export const getAttachments = (object: BaseNote): Document[] => {
  const attachments: Document[] = []
  if (object.attachment) {
    const list = Array.isArray(object.attachment)
      ? object.attachment
      : [object.attachment]
    attachments.push(
      ...list
        .map(toMediaDocument)
        .filter((item): item is Document => Boolean(item))
    )
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
  // Attachment urls are rendered as link and media targets (the DM bubble's
  // download link, Mastodon `media_attachments[].url`), so a remote Document
  // whose url is not http(s) is dropped rather than persisted. A remote Note's
  // `attachment` array is also the sender's to size: every entry becomes an
  // attachment row (createNoteJob writes them all at once) and a media element
  // in every viewer's timeline, so ingest keeps no more than a local status may
  // store.
  return attachments
    .filter((attachment) => isHttpUrl(attachment.url))
    .slice(0, MAX_STORED_MEDIA_ATTACHMENTS)
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

// Types whose `name` is a title shown above the body, as Mastodon does for
// Video, Page (Lemmy) and Article (WriteFreely, Plume, WordPress).
const TITLED_TYPES = new Set<string>(['Video', 'Article', 'Page'])
const LINKED_WHEN_EMPTY_TYPES = new Set<string>(['Article', 'Page'])

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
    TITLED_TYPES.has(object.type) &&
    'name' in object &&
    typeof object.name === 'string' &&
    object.name.trim()
  ) {
    const title = escapeHtml(object.name.trim())
    const titleHeader = `<p><strong>${title}</strong></p>`
    if (!content.startsWith(titleHeader)) {
      // A Lemmy post or a blog article may carry only its title and a url to
      // the full page. Link that url so the status still points somewhere.
      if (!content.trim() && LINKED_WHEN_EMPTY_TYPES.has(object.type)) {
        const href = getUrl(object.url)
        if (href) {
          const escapedHref = escapeHtml(href)
          const link = `<p><a href="${escapedHref}" rel="nofollow noopener noreferrer" target="_blank">${escapedHref}</a></p>`
          return `${titleHeader}\n${link}`
        }
      }
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
