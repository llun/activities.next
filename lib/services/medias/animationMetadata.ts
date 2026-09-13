import { getServerSoftware } from '@/lib/services/federation/serverSoftware'
import { MediaDatabase } from '@/lib/types/database/operations'
import { Attachment, PlaybackType } from '@/lib/types/domain/attachment'
import {
  isSameActivityPubOrigin,
  normalizeActorId
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

export interface AnimationMetadataItem {
  playbackType: PlaybackType
  previewUrl: string | null
}

export interface ResolveAnimationMetadataParams {
  statusUrl?: string | null
  statusId?: string | null
  authorId?: string | null
  attachments: Array<{
    url: string
    mediaType?: string | null
  }>
}

interface MastodonMediaAttachment {
  id: string
  type: string
  url?: string | null
  remote_url?: string | null
  preview_url?: string | null
}

interface MastodonAccount {
  id?: string | null
  url?: string | null
  acct?: string | null
  username?: string | null
}

interface MastodonStatusResponse {
  id: string
  uri?: string | null
  url?: string | null
  account?: MastodonAccount | null
  media_attachments?: MastodonMediaAttachment[] | null
}

type CacheEntry = {
  data: Record<string, AnimationMetadataItem> | null
  expiresAt: number
}

export const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
export const FAILURE_TTL_MS = 5 * 60 * 1000
export const MAX_CACHED_STATUSES = 512
const REMOTE_STATUS_TIMEOUT_MS = 5000
const MAX_RESPONSE_BYTES = 256 * 1024

const statusMetadataCache = new Map<string, CacheEntry>()
const inFlightRequests = new Map<
  string,
  Promise<Record<string, AnimationMetadataItem> | null>
>()

export const clearAnimationMetadataCacheForTests = () => {
  statusMetadataCache.clear()
  inFlightRequests.clear()
}

export const getAnimationMetadataCacheSizeForTests = () =>
  statusMetadataCache.size

const setBoundedCache = (
  key: string,
  data: Record<string, AnimationMetadataItem> | null,
  ttlMs: number
) => {
  if (statusMetadataCache.has(key)) {
    statusMetadataCache.delete(key)
  } else if (statusMetadataCache.size >= MAX_CACHED_STATUSES) {
    const oldestKey = statusMetadataCache.keys().next().value
    if (oldestKey !== undefined) {
      statusMetadataCache.delete(oldestKey)
    }
  }

  statusMetadataCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  })
}

const normalizeUrlForMatch = (url: string | null | undefined): string => {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.split(/[?#]/)[0] || url
  }
}

export const extractMastodonStatusInfo = (
  statusUrl?: string | null,
  statusId?: string | null
): { domain: string; statusId: string } | null => {
  const candidates = [statusId, statusUrl].filter(
    (c): c is string => typeof c === 'string' && c.trim().length > 0
  )

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate)
      const domain = parsed.host.toLowerCase()
      if (!domain) continue

      // Mastodon URL path patterns:
      // /users/:username/statuses/:id
      // /@:username/:id
      // /statuses/:id
      const match = parsed.pathname.match(
        /(?:\/users\/[^/]+\/statuses\/|\/@[^/]+\/|\/statuses\/)([A-Za-z0-9_-]+)/
      )
      if (match?.[1]) {
        return { domain, statusId: match[1] }
      }
    } catch {
      // Not a full URL, continue
    }
  }

  return null
}

export const isSameAuthor = (
  account: MastodonAccount | null | undefined,
  authorId: string
): boolean => {
  if (!account) return false
  const accountUrl = account.url || ''
  if (
    accountUrl &&
    normalizeActorId(accountUrl) === normalizeActorId(authorId)
  ) {
    return true
  }

  try {
    const authorParsed = new URL(authorId)
    const authorHost = authorParsed.host.toLowerCase()
    const authorUsername = authorParsed.pathname
      .match(/(?:\/users\/|\/@)([^/?#]+)/)?.[1]
      ?.toLowerCase()

    if (!authorUsername) return false

    if (accountUrl) {
      const accountParsed = new URL(accountUrl)
      if (accountParsed.host.toLowerCase() !== authorHost) {
        return false
      }
      const accountUrlUsername = accountParsed.pathname
        .match(/(?:\/users\/|\/@)([^/?#]+)/)?.[1]
        ?.toLowerCase()
      if (accountUrlUsername === authorUsername) {
        return true
      }
    }

    const rawUsername = (account.username || account.acct?.split('@')[0] || '')
      .trim()
      .toLowerCase()
    if (rawUsername && rawUsername === authorUsername) {
      return true
    }
  } catch {
    return false
  }

  return false
}

const isMastodonCompatibleSoftware = async (
  domain: string
): Promise<boolean> => {
  const software = await getServerSoftware(domain)
  if (software === null) {
    // If NodeInfo could not be retrieved, fail open and attempt the lookup
    // since the URL already matched Mastodon's status structure.
    return true
  }
  const normalized = software.trim().toLowerCase()
  return (
    normalized === 'mastodon' ||
    normalized === 'glitch' ||
    normalized === 'glitch-soc' ||
    normalized === 'hometown'
  )
}

const fetchMastodonStatusMetadata = async (
  domain: string,
  mastodonStatusId: string,
  statusUrl?: string | null,
  statusId?: string | null,
  authorId?: string | null
): Promise<Record<string, AnimationMetadataItem> | null> => {
  const requestUrl = `https://${domain}/api/v1/statuses/${mastodonStatusId}`

  try {
    const result = await safeRemoteFetch({
      url: requestUrl,
      timeoutInMilliseconds: REMOTE_STATUS_TIMEOUT_MS,
      maxBodyBytes: MAX_RESPONSE_BYTES,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'activities.next'
      }
    })

    if (result.statusCode !== 200 || !result.body) {
      return null
    }

    const payload = JSON.parse(result.body) as MastodonStatusResponse
    if (!payload || typeof payload !== 'object') {
      return null
    }

    // 1. Status identity check: verify that the returned status matches what was requested
    const requestedIdMatches =
      payload.id === mastodonStatusId ||
      (typeof payload.uri === 'string' && payload.uri === statusId) ||
      (typeof payload.url === 'string' && payload.url === statusUrl) ||
      (typeof payload.uri === 'string' &&
        typeof statusId === 'string' &&
        isSameActivityPubOrigin(payload.uri, statusId))

    if (!requestedIdMatches) {
      logger.warn({
        message: 'Mastodon status ID mismatch in animation metadata lookup',
        domain,
        requestedStatusId: mastodonStatusId,
        returnedId: payload.id,
        returnedUri: payload.uri
      })
      return null
    }

    // 2. Author check: verify attribution
    if (authorId && !isSameAuthor(payload.account, authorId)) {
      logger.warn({
        message: 'Author mismatch in Mastodon animation metadata lookup',
        domain,
        expectedAuthorId: authorId,
        returnedAccountUrl: payload.account?.url ?? null
      })
      return null
    }

    const mediaList = Array.isArray(payload.media_attachments)
      ? payload.media_attachments
      : []

    const metadataMap: Record<string, AnimationMetadataItem> = {}

    for (const media of mediaList) {
      if (!media || typeof media !== 'object') continue

      const itemType = media.type
      const playbackType: PlaybackType =
        itemType === 'gifv'
          ? 'gifv'
          : itemType === 'video'
            ? 'video'
            : 'unknown'
      const previewUrl = media.preview_url ?? null

      const targets = [media.url, media.remote_url, media.preview_url].filter(
        (u): u is string => typeof u === 'string' && u.length > 0
      )

      for (const target of targets) {
        const normalized = normalizeUrlForMatch(target)
        if (normalized) {
          metadataMap[normalized] = { playbackType, previewUrl }
        }
      }
    }

    return metadataMap
  } catch (error) {
    logger.warn({
      message: 'Failed to fetch Mastodon animation metadata',
      domain,
      statusId: mastodonStatusId,
      err: toLoggableError(error)
    })
    return null
  }
}

export const resolveAnimationMetadata = async ({
  statusUrl,
  statusId,
  authorId,
  attachments
}: ResolveAnimationMetadataParams): Promise<
  Record<string, AnimationMetadataItem>
> =>
  withSpan(
    'media',
    'resolveAnimationMetadata',
    {
      statusId: statusId ?? undefined,
      statusUrl: statusUrl ?? undefined
    },
    async () => {
      const videoAttachments = attachments.filter(
        (att) => att.mediaType && att.mediaType.startsWith('video')
      )
      if (videoAttachments.length === 0) {
        return {}
      }

      const info = extractMastodonStatusInfo(statusUrl, statusId)
      if (!info) {
        return mapAttachments(videoAttachments, null)
      }

      const { domain, statusId: mastodonStatusId } = info
      const cacheKey = `${domain}:${mastodonStatusId}`

      const cached = statusMetadataCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return mapAttachments(videoAttachments, cached.data)
      }

      const isSupported = await isMastodonCompatibleSoftware(domain)
      if (!isSupported) {
        setBoundedCache(cacheKey, null, FAILURE_TTL_MS)
        return mapAttachments(videoAttachments, null)
      }

      let promise = inFlightRequests.get(cacheKey)
      if (!promise) {
        promise = (async () => {
          try {
            const result = await fetchMastodonStatusMetadata(
              domain,
              mastodonStatusId,
              statusUrl,
              statusId,
              authorId
            )
            const ttl = result ? SUCCESS_TTL_MS : FAILURE_TTL_MS
            setBoundedCache(cacheKey, result, ttl)
            return result
          } finally {
            inFlightRequests.delete(cacheKey)
          }
        })()
        inFlightRequests.set(cacheKey, promise)
      }

      const metadataMap = await promise
      return mapAttachments(videoAttachments, metadataMap)
    }
  )

const mapAttachments = (
  attachments: Array<{ url: string; mediaType?: string | null }>,
  metadataMap: Record<string, AnimationMetadataItem> | null
): Record<string, AnimationMetadataItem> => {
  const result: Record<string, AnimationMetadataItem> = {}

  for (const attachment of attachments) {
    const normalized = normalizeUrlForMatch(attachment.url)
    const match = metadataMap ? metadataMap[normalized] : undefined

    if (match) {
      result[attachment.url] = match
    } else {
      result[attachment.url] = {
        playbackType: 'unknown',
        previewUrl: null
      }
    }
  }

  return result
}

export const enrichStatusAttachments = async <
  T extends {
    id: string
    url?: string | null
    actorId?: string | null
    attachments: Attachment[]
  }
>(
  status: T,
  database?: MediaDatabase
): Promise<T> => {
  const needsResolution = status.attachments.filter(
    (att) => att.mediaType.startsWith('video') && !att.playbackType
  )

  if (needsResolution.length === 0) {
    return status
  }

  try {
    const resolved = await resolveAnimationMetadata({
      statusUrl: status.url,
      statusId: status.id,
      authorId: status.actorId,
      attachments: needsResolution.map((att) => ({
        url: att.url,
        mediaType: att.mediaType
      }))
    })

    for (const attachment of needsResolution) {
      const match = resolved[attachment.url]
      if (match && match.playbackType !== 'unknown') {
        attachment.playbackType = match.playbackType
        if (!attachment.thumbnailUrl && match.previewUrl) {
          attachment.thumbnailUrl = match.previewUrl
        }

        if (database) {
          await database.updateAttachmentPlayback({
            id: attachment.id,
            playbackType: match.playbackType,
            thumbnailUrl: attachment.thumbnailUrl ?? null
          })
        }
      }
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to enrich status attachments with animation metadata',
      statusId: status.id,
      err: toLoggableError(error)
    })
  }

  return status
}
