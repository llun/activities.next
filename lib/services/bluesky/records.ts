// Pure mapping from Bluesky (atproto) records and views to the ids, HTML and
// attachments this server stores them as. Everything here reads data from
// another server, so each value is checked before it is used.
import type { BlueskyPostAttachment } from '@/lib/database/domains/bluesky/types'

export { isBlueskyId } from '@/lib/utils/blueskyId'

const PROFILE_BASE = 'https://bsky.app/profile/'
const DID_PATTERN = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/

export const blueskyActorId = (did: string) => `${PROFILE_BASE}${did}`

export const blueskyPostId = (did: string, rkey: string) =>
  `${PROFILE_BASE}${did}/post/${rkey}`

// at://<did>/<collection>/<rkey>; an authority that is a handle is refused,
// since the stored ids are keyed on the DID.
export const parseAtUri = (
  uri: string
): { did: string; collection: string; rkey: string } | null => {
  const match = /^at:\/\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)$/.exec(uri)
  if (!match || !DID_PATTERN.test(match[1])) return null
  return { did: match[1], collection: match[2], rkey: match[3] }
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const textToHtml = (text: string) => escapeHtml(text).replace(/\r?\n/g, '<br>')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const httpUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

// The href a facet links its text to, or null when it has no feature this
// server renders.
const facetHref = (features: unknown): string | null => {
  if (!Array.isArray(features)) return null
  for (const feature of features) {
    if (!isRecord(feature)) continue
    switch (feature.$type) {
      case 'app.bsky.richtext.facet#link': {
        const href = httpUrl(feature.uri)
        if (href) return href
        break
      }
      case 'app.bsky.richtext.facet#mention':
        if (typeof feature.did === 'string' && DID_PATTERN.test(feature.did)) {
          return blueskyActorId(feature.did)
        }
        break
      case 'app.bsky.richtext.facet#tag':
        if (typeof feature.tag === 'string' && feature.tag) {
          return `https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}`
        }
        break
    }
  }
  return null
}

// A post's text and facets as HTML. Facet indexes count UTF-8 bytes, not
// UTF-16 code units, so the text is sliced as bytes.
export const blueskyPostToHtml = (text: string, facets?: unknown): string => {
  if (!text) return ''
  const bytes = new TextEncoder().encode(text)
  const decoder = new TextDecoder()
  const slice = (start: number, end: number) =>
    decoder.decode(bytes.subarray(start, end))

  const links = (Array.isArray(facets) ? facets : [])
    .flatMap((facet) => {
      if (!isRecord(facet) || !isRecord(facet.index)) return []
      const { byteStart, byteEnd } = facet.index
      if (
        !Number.isInteger(byteStart) ||
        !Number.isInteger(byteEnd) ||
        (byteStart as number) < 0 ||
        (byteEnd as number) <= (byteStart as number) ||
        (byteEnd as number) > bytes.length
      ) {
        return []
      }
      const href = facetHref(facet.features)
      return href
        ? [{ start: byteStart as number, end: byteEnd as number, href }]
        : []
    })
    .sort((a, b) => a.start - b.start)

  let html = ''
  let cursor = 0
  for (const link of links) {
    // Overlapping facets: the earlier one wins.
    if (link.start < cursor) continue
    html += textToHtml(slice(cursor, link.start))
    html += `<a href="${escapeHtml(link.href)}" rel="nofollow noopener noreferrer" target="_blank">${textToHtml(slice(link.start, link.end))}</a>`
    cursor = link.end
  }
  html += textToHtml(slice(cursor, bytes.length))
  return `<p>${html}</p>`
}

const positiveInteger = (value: unknown) =>
  Number.isInteger(value) && (value as number) > 0
    ? (value as number)
    : undefined

const imagesFromView = (view: unknown): BlueskyPostAttachment[] => {
  if (
    !isRecord(view) ||
    view.$type !== 'app.bsky.embed.images#view' ||
    !Array.isArray(view.images)
  ) {
    return []
  }
  return view.images.flatMap((image): BlueskyPostAttachment[] => {
    if (!isRecord(image)) return []
    const url = httpUrl(image.fullsize)
    if (!url) return []
    const aspectRatio = isRecord(image.aspectRatio) ? image.aspectRatio : {}
    const width = positiveInteger(aspectRatio.width)
    const height = positiveInteger(aspectRatio.height)
    return [
      {
        url,
        thumbnailUrl: httpUrl(image.thumb),
        // The Bluesky CDN serves feed images as JPEG.
        mediaType: 'image/jpeg',
        ...(width && height ? { width, height } : null),
        ...(typeof image.alt === 'string' && image.alt
          ? { description: image.alt }
          : null)
      }
    ]
  })
}

// The images of a post's embed view, also inside a quote's media. Other
// embeds (video, external cards, quotes alone) give none for now.
export const blueskyImagesFromEmbed = (
  embed: unknown
): BlueskyPostAttachment[] => {
  if (!isRecord(embed)) return []
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
    return imagesFromView(embed.media)
  }
  return imagesFromView(embed)
}
