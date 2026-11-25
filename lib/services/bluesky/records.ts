// Mapping from Bluesky (atproto) records and views to the ids, HTML and
// attachments this server stores them as, and the one place that stores an
// AppView post or profile view. Everything here reads data from another
// server, so each value is checked before it is used.
import type { BlueskyPostAttachment } from '@/lib/database/domains/bluesky/types'
import type { Database } from '@/lib/database/types'
import {
  BLUESKY_DID_PATTERN,
  parseBlueskyActorQuery
} from '@/lib/utils/accountHandle'
import { BLUESKY_DOMAIN, BLUESKY_PROFILE_PREFIX } from '@/lib/utils/blueskyId'
import { isRecord } from '@/lib/utils/typeGuards'

export { isBlueskyId } from '@/lib/utils/blueskyId'

export const DID_PATTERN = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/
// The atproto record-key syntax.
const RKEY_PATTERN = /^[A-Za-z0-9._:~-]{1,512}$/
// The actor and status id, username, name and media URL columns are
// varchar(255) on PostgreSQL: a longer value would fail the whole write.
const MAX_COLUMN_LENGTH = 255

export const blueskyActorId = (did: string) => `${BLUESKY_PROFILE_PREFIX}${did}`

export const blueskyPostId = (did: string, rkey: string) =>
  `${BLUESKY_PROFILE_PREFIX}${did}/post/${rkey}`

// at://<did>/<collection>/<rkey>; an authority that is a handle is refused,
// since the stored ids are keyed on the DID.
export const parseAtUri = (
  uri: string
): { did: string; collection: string; rkey: string } | null => {
  const match = /^at:\/\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)$/.exec(uri)
  if (!match || !DID_PATTERN.test(match[1]) || !RKEY_PATTERN.test(match[3])) {
    return null
  }
  return { did: match[1], collection: match[2], rkey: match[3] }
}

// The public bsky.app URL of a post record uri, or null when it is not one.
export const blueskyPostWebUrl = (uri: string): string | null => {
  const at = parseAtUri(uri)
  return at && at.collection === 'app.bsky.feed.post'
    ? `https://${BLUESKY_DOMAIN}/profile/${at.did}/post/${at.rkey}`
    : null
}

export const optionalString = (value: unknown) =>
  typeof value === 'string' ? value : undefined

export const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const textToHtml = (text: string) => escapeHtml(text).replace(/\r?\n/g, '<br>')

const MAX_CARD_URL_LENGTH = 2048
const MAX_CARD_TITLE_LENGTH = 300

const LINK_ATTRS = 'rel="nofollow noopener noreferrer" target="_blank"'

const linkParagraph = (href: string, label: string) =>
  `<p><a href="${escapeHtml(href)}" ${LINK_ATTRS}>${escapeHtml(label)}</a></p>`

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

// A stored media URL (avatar, banner, image): https only, and short enough
// for its column.
const mediaUrl = (value: unknown): string | null => {
  const url = httpUrl(value)
  return url?.startsWith('https:') && url.length <= MAX_COLUMN_LENGTH
    ? url
    : null
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
          return `https://${BLUESKY_DOMAIN}/hashtag/${encodeURIComponent(feature.tag)}`
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
    html += `<a href="${escapeHtml(link.href)}" ${LINK_ATTRS}>${textToHtml(slice(link.start, link.end))}</a>`
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
    const url = mediaUrl(image.fullsize)
    if (!url) return []
    const aspectRatio = isRecord(image.aspectRatio) ? image.aspectRatio : {}
    const width = positiveInteger(aspectRatio.width)
    const height = positiveInteger(aspectRatio.height)
    return [
      {
        url,
        thumbnailUrl: mediaUrl(image.thumb),
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

// The images of a post's embed view, also inside a quote's media. Non-image
// embeds (external cards, quotes, videos) are rendered as links by
// `blueskyEmbedLinksHtml` instead of media attachments.
export const blueskyImagesFromEmbed = (
  embed: unknown
): BlueskyPostAttachment[] => {
  if (!isRecord(embed)) return []
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
    return imagesFromView(embed.media)
  }
  return imagesFromView(embed)
}

const POST_COLLECTION = 'app.bsky.feed.post'
const INVALID_HANDLE = 'handle.invalid'

// A post record this server wrote for a status: the same record type and the
// status's own createdAt. A deterministic rkey can collide with a foreign
// record, so a delete of one is only safe once this holds.
export const isOwnBlueskyPostRecord = (
  value: unknown,
  expectedCreatedAt: string
): boolean =>
  isRecord(value) &&
  value.$type === POST_COLLECTION &&
  value.createdAt === expectedCreatedAt

const externalLinkHtml = (
  embed: Record<string, unknown>,
  postHtml: string
): string => {
  if (!isRecord(embed.external)) return ''
  const href = httpUrl(embed.external.uri)
  // The author picks the card: keep it to a sane size in the shared row.
  if (!href || href.length > MAX_CARD_URL_LENGTH) return ''
  if (postHtml.includes(`href="${escapeHtml(href)}"`)) return ''
  const title = optionalString(embed.external.title)?.trim()
  return linkParagraph(
    href,
    title ? Array.from(title).slice(0, MAX_CARD_TITLE_LENGTH).join('') : href
  )
}

const videoLinkHtml = (postUrl: string): string => {
  const href = httpUrl(postUrl)
  return href ? linkParagraph(href, 'Video on Bluesky') : ''
}

const quotedPostLinkHtml = (recordView: unknown): string => {
  if (!isRecord(recordView) || !isRecord(recordView.record)) return ''
  const quoted = recordView.record
  if (quoted.$type !== 'app.bsky.embed.record#viewRecord') return ''
  const at = parseAtUri(optionalString(quoted.uri) ?? '')
  if (!at || at.collection !== POST_COLLECTION) return ''
  return linkParagraph(blueskyPostId(at.did, at.rkey), 'Quoted post')
}

const mediaEmbedLinkHtml = (
  media: unknown,
  postUrl: string,
  postHtml: string
): string => {
  if (!isRecord(media)) return ''
  switch (media.$type) {
    case 'app.bsky.embed.external#view':
      return externalLinkHtml(media, postHtml)
    case 'app.bsky.embed.video#view':
      return videoLinkHtml(postUrl)
    default:
      return ''
  }
}

// Extra HTML paragraphs appended to a post for non-image embeds (external link
// cards, quoted posts, videos). Skips an external card whose URI already
// appears as a link in `postHtml`.
export const blueskyEmbedLinksHtml = (
  embed: unknown,
  postUrl: string,
  postHtml = ''
): string => {
  if (!isRecord(embed)) return ''
  switch (embed.$type) {
    case 'app.bsky.embed.external#view':
      return externalLinkHtml(embed, postHtml)
    case 'app.bsky.embed.record#view':
      return quotedPostLinkHtml(embed)
    case 'app.bsky.embed.recordWithMedia#view':
      return (
        mediaEmbedLinkHtml(embed.media, postUrl, postHtml) +
        quotedPostLinkHtml(embed.record)
      )
    case 'app.bsky.embed.video#view':
      return videoLinkHtml(postUrl)
    default:
      return ''
  }
}

// Bluesky's content-warning labels for adult and graphic media.
const SENSITIVE_LABELS = new Set([
  'porn',
  'sexual',
  'nudity',
  'graphic-media',
  'gore',
  '!warn'
])

const labelValues = (labels: unknown): unknown[] =>
  Array.isArray(labels)
    ? labels.map((label) => (isRecord(label) ? label.val : undefined))
    : []

/**
 * Whether a post carries a content-warning label: a moderation label on the
 * AppView view (`labels[].val`) or the author's own self-label
 * (`record.labels.values[].val`).
 */
export const isBlueskyPostSensitive = (view: unknown): boolean => {
  if (!isRecord(view)) return false
  const record = isRecord(view.record) ? view.record : {}
  const selfLabels = isRecord(record.labels) ? record.labels.values : undefined
  return [...labelValues(view.labels), ...labelValues(selfLabels)].some(
    (value) => typeof value === 'string' && SENSITIVE_LABELS.has(value)
  )
}

const optionalCount = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined

/**
 * Stores the author of an AppView profile view (app.bsky.actor.defs#profileView
 * and its basic and detailed forms) and returns its actor id; null when the
 * view names no valid DID. Pass `full` for a detailed view (getProfiles): its
 * missing description or banner then clears the stored one, where a basic view
 * (a post's author) carries neither and keeps them.
 */
export const storeBlueskyAuthor = async (
  database: Database,
  profile: unknown,
  { full = false }: { full?: boolean } = {}
): Promise<string | null> => {
  if (!isRecord(profile)) return null
  const did = optionalString(profile.did)
  if (
    !did ||
    !BLUESKY_DID_PATTERN.test(did) ||
    blueskyActorId(did).length > MAX_COLUMN_LENGTH
  ) {
    return null
  }
  // The AppView only reports a handle whose DNS or well-known record points
  // back at this DID (and whose DID document names the handle), so its handle
  // is trusted. An unverified one (`handle.invalid`) or one that is not a
  // hostname stores the DID as the username instead: it never takes a handle
  // from another row.
  const claimed = optionalString(profile.handle)?.toLowerCase()
  const handle =
    claimed &&
    claimed !== INVALID_HANDLE &&
    parseBlueskyActorQuery(claimed) === claimed
      ? claimed
      : did
  const description = optionalString(profile.description)
  const banner = mediaUrl(profile.banner)
  const name = optionalString(profile.displayName)
  return database.upsertBlueskyActor({
    did,
    handle,
    name: name ? Array.from(name).slice(0, MAX_COLUMN_LENGTH).join('') : null,
    summary: description
      ? blueskyPostToHtml(description)
      : full
        ? null
        : undefined,
    iconUrl: mediaUrl(profile.avatar),
    headerImageUrl: banner ?? (full ? null : undefined),
    followersCount: optionalCount(profile.followersCount),
    followingCount: optionalCount(profile.followsCount),
    postsCount: optionalCount(profile.postsCount)
  })
}

/**
 * A post view (app.bsky.feed.defs#postView) whose record is a post by the
 * view's author; null for anything else (a not-found or blocked post, another
 * record type).
 */
export const parseBlueskyPostView = (value: unknown) => {
  if (!isRecord(value) || !isRecord(value.author) || !isRecord(value.record)) {
    return null
  }
  const { uri, cid, author, record } = value
  if (
    typeof uri !== 'string' ||
    typeof cid !== 'string' ||
    record.$type !== POST_COLLECTION
  ) {
    return null
  }
  const at = parseAtUri(uri)
  if (!at || at.collection !== POST_COLLECTION || at.did !== author.did) {
    return null
  }
  return { uri, cid, at, author, record, view: value }
}

export type BlueskyPostView = NonNullable<
  ReturnType<typeof parseBlueskyPostView>
>

/**
 * Stores an AppView post view and its author, and returns the status id; null
 * when the author or post cannot be stored (an id too long for its column). A
 * reply links to its parent's status id whether or not the parent is stored.
 */
export const storeBlueskyPostView = async (
  database: Database,
  post: BlueskyPostView
): Promise<string | null> => {
  const { record } = post
  const parentUri =
    isRecord(record.reply) && isRecord(record.reply.parent)
      ? (optionalString(record.reply.parent.uri) ?? '')
      : ''
  const parent = parentUri ? parseAtUri(parentUri) : null
  const isPostParent = parent?.collection === POST_COLLECTION
  // A reply to the Bluesky copy of a local post shows under the local post,
  // unless the post itself is a local cross-post (its local original already
  // replies to the local parent).
  const crosspostParent = isPostParent
    ? (await database.getBlueskyCrosspostByUri({ uri: post.uri }))
      ? null
      : await database.getBlueskyCrosspostByUri({ uri: parentUri })
    : null
  const replyToStatusId =
    crosspostParent?.statusId ??
    (parent && isPostParent ? blueskyPostId(parent.did, parent.rkey) : null)
  const postUrl = blueskyPostId(post.at.did, post.at.rkey)
  if (
    postUrl.length > MAX_COLUMN_LENGTH ||
    (replyToStatusId?.length ?? 0) > MAX_COLUMN_LENGTH ||
    post.cid.length > MAX_COLUMN_LENGTH
  ) {
    return null
  }
  const actorId = await storeBlueskyAuthor(database, post.author)
  if (!actorId) return null
  const now = Date.now()
  const createdAt =
    Date.parse(optionalString(record.createdAt) ?? '') ||
    Date.parse(optionalString(post.view.indexedAt) ?? '') ||
    now
  const postHtml = blueskyPostToHtml(
    optionalString(record.text) ?? '',
    record.facets
  )
  const { statusId } = await database.upsertBlueskyPost({
    uri: post.uri,
    cid: post.cid,
    did: post.at.did,
    rkey: post.at.rkey,
    actorId,
    text: postHtml + blueskyEmbedLinksHtml(post.view.embed, postUrl, postHtml),
    // A clock ahead of ours must not pin the post to the top of a feed.
    createdAt: Math.min(createdAt, now),
    replyToStatusId,
    attachments: blueskyImagesFromEmbed(post.view.embed),
    sensitive: isBlueskyPostSensitive(post.view)
  })
  await database.setBlueskyPostCounts({
    statusId,
    likes: optionalCount(post.view.likeCount),
    reposts: optionalCount(post.view.repostCount),
    replies: optionalCount(post.view.replyCount)
  })
  return statusId
}
