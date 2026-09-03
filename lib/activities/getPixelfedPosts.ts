import { detectLanguageFromHtml } from '@/lib/services/language-detection'
import { Actor } from '@/lib/types/activitypub'
import { ActorProfile, Actor as DomainActor } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

export const PIXELFED_PAGE_LIMIT = 20

export interface PixelfedMediaAttachment {
  id: string | number
  type: string
  url: string
  remote_url?: string | null
  preview_url?: string | null
  text_url?: string | null
  meta?: {
    focus?: { x: number; y: number }
    original?: {
      width?: number
      height?: number
      size?: string
      aspect?: number
    }
  }
  description?: string | null
  blurhash?: string | null
  mime?: string | null
}

export interface PixelfedTag {
  name: string
  url: string
}

export interface PixelfedStatus {
  id: string
  uri?: string
  url?: string
  in_reply_to_id?: string | null
  content?: string
  created_at: string
  reblogs_count?: number
  favourites_count?: number
  reply_count?: number
  sensitive?: boolean
  spoiler_text?: string
  language?: string | null
  media_attachments?: PixelfedMediaAttachment[]
  tags?: PixelfedTag[]
  favourited?: boolean | null
  reblogged?: boolean | null
  bookmarked?: boolean | null
}

export interface GetPixelfedPostsParams {
  person: Actor
  pageUrl?: string | null
  actor?: ActorProfile | DomainActor | null
}

export interface GetPixelfedPostsResult {
  statusesCount: number
  statuses: Status[]
  nextPageUrl: string | null
  prevPageUrl: string | null
}

export const getPixelfedAccountId = async (
  domain: string,
  username: string
): Promise<string | null> => {
  try {
    const { statusCode, body } = await request({
      url: `https://${domain}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'activities.next'
      }
    })
    if (statusCode !== 200 || !body || typeof body !== 'string') {
      return null
    }
    const data = JSON.parse(body) as { id?: string | number }
    return data.id ? String(data.id) : null
  } catch (error) {
    logger.warn({
      message: 'Failed to lookup Pixelfed account id',
      domain,
      username,
      err: toLoggableError(error)
    })
    return null
  }
}

export const fromPixelfedStatus = (
  item: PixelfedStatus,
  person: Actor,
  actorProfile: ActorProfile | null
): Status => {
  const domain = new URL(person.id).host
  const statusId =
    item.uri ||
    item.url ||
    `https://${domain}/p/${person.preferredUsername}/${item.id}`
  const statusUrl =
    item.url || `https://${domain}/p/${person.preferredUsername}/${item.id}`
  const createdAtTime = new Date(item.created_at).getTime() || Date.now()
  const content = item.content || ''

  const attachments: Attachment[] = (item.media_attachments || []).map(
    (media, index) => ({
      id: String(media.id || `${item.id}-${index}`),
      actorId: person.id,
      statusId,
      type: 'Document',
      mediaType:
        media.type === 'video' ? 'video/mp4' : media.mime || 'image/jpeg',
      url: media.url,
      name: media.description || '',
      width: media.meta?.original?.width,
      height: media.meta?.original?.height,
      blurhash: media.blurhash || null,
      thumbnailUrl: media.preview_url || null,
      focus: media.meta?.focus || null,
      createdAt: createdAtTime,
      updatedAt: createdAtTime
    })
  )

  const tags: Tag[] = (item.tags || []).map((tag, tagIndex) => ({
    id: `${statusId}-tag-${tagIndex}`,
    statusId,
    type: 'hashtag',
    name: tag.name.startsWith('#') ? tag.name : `#${tag.name}`,
    value: tag.url,
    createdAt: createdAtTime,
    updatedAt: createdAtTime
  }))

  return StatusNote.parse({
    id: statusId,
    url: statusUrl,
    actorId: person.id,
    actor: actorProfile,
    type: StatusType.enum.Note,
    text: content,
    summary: item.spoiler_text || null,
    sensitive: Boolean(item.sensitive),
    language: item.language || null,
    detectedLanguage: detectLanguageFromHtml(content)?.language ?? null,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [person.followers || `${person.id}/followers`],
    edits: [],
    reply: item.in_reply_to_id ? String(item.in_reply_to_id) : '',
    replies: [],
    totalReplies: item.reply_count ?? 0,
    actorAnnounceStatusId: null,
    isActorLiked: Boolean(item.favourited),
    isActorBookmarked: Boolean(item.bookmarked),
    totalLikes: item.favourites_count ?? 0,
    totalShares: item.reblogs_count ?? 0,
    attachments,
    tags,
    createdAt: createdAtTime,
    updatedAt: createdAtTime,
    isLocalActor: false
  })
}

export const getPixelfedPosts = async ({
  person,
  pageUrl,
  actor
}: GetPixelfedPostsParams): Promise<GetPixelfedPostsResult | null> =>
  withSpan('activity', 'getPixelfedPosts', { actorId: person.id }, async () => {
    try {
      const domain = new URL(person.id).host
      let fetchUrl: string

      let accountId: string | null = null
      if (pageUrl) {
        fetchUrl = pageUrl
      } else {
        accountId = await getPixelfedAccountId(domain, person.preferredUsername)
        if (!accountId) return null
        fetchUrl = `https://${domain}/api/pixelfed/v1/accounts/${accountId}/statuses?limit=${PIXELFED_PAGE_LIMIT}`
      }

      const { statusCode, body } = await request({
        url: fetchUrl,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'activities.next'
        }
      })

      if (statusCode !== 200 || !body || typeof body !== 'string') {
        return null
      }

      const items = JSON.parse(body)
      if (!Array.isArray(items)) {
        return null
      }

      const actorProfile = actor
        ? (ActorProfile.safeParse(actor).data ?? null)
        : null

      const statuses: Status[] = items.map((item) =>
        fromPixelfedStatus(item, person, actorProfile)
      )

      let nextPageUrl: string | null = null
      if (items.length >= PIXELFED_PAGE_LIMIT) {
        const lastItem = items[items.length - 1]
        if (lastItem?.id) {
          if (!accountId) {
            // If fetching from a pageUrl, extract or resolve accountId
            const match = fetchUrl.match(/\/accounts\/([^/]+)\/statuses/)
            accountId = match ? match[1] : null
          }
          if (accountId) {
            nextPageUrl = `https://${domain}/api/pixelfed/v1/accounts/${accountId}/statuses?limit=${PIXELFED_PAGE_LIMIT}&max_id=${lastItem.id}`
          }
        }
      }

      return {
        statusesCount: statuses.length,
        statuses,
        nextPageUrl,
        prevPageUrl: null
      }
    } catch (error) {
      logger.warn({
        message: 'Failed to fetch Pixelfed posts',
        actorId: person.id,
        err: toLoggableError(error)
      })
      return null
    }
  })
