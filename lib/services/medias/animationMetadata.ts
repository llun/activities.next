import { getServerSoftware } from '@/lib/services/federation/serverSoftware'
import { MediaDatabase } from '@/lib/types/database/operations'
import { Attachment, PlaybackType } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { mapWithConcurrency } from '@/lib/utils/mapWithConcurrency'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

export interface AnimationMetadataItem {
  playbackType: PlaybackType
  previewUrl: string | null
  definitive?: boolean
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
  definitive: boolean
}

interface StatusFetchResult {
  data: Record<string, AnimationMetadataItem> | null
  definitive: boolean
}

export const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
export const FAILURE_TTL_MS = 5 * 60 * 1000
export const MAX_CACHED_STATUSES = 512
const REMOTE_STATUS_TIMEOUT_MS = 5000
const MAX_RESPONSE_BYTES = 256 * 1024

const statusMetadataCache = new Map<string, CacheEntry>()
const inFlightRequests = new Map<string, Promise<StatusFetchResult>>()

export const clearAnimationMetadataCacheForTests = () => {
  statusMetadataCache.clear()
  inFlightRequests.clear()
}

export const getAnimationMetadataCacheSizeForTests = () =>
  statusMetadataCache.size

const setBoundedCache = (
  key: string,
  data: Record<string, AnimationMetadataItem> | null,
  ttlMs: number,
  definitive: boolean
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
    expiresAt: Date.now() + ttlMs,
    definitive
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
  authorId: string,
  serverDomain?: string
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

    const acctHost = account.acct?.includes('@')
      ? account.acct.split('@')[1]?.toLowerCase()
      : serverDomain?.toLowerCase()

    if (acctHost && acctHost !== authorHost) {
      return false
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
): Promise<StatusFetchResult> => {
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

    if (result.statusCode === 404 || result.statusCode === 410) {
      return { data: null, definitive: true }
    }

    if (result.statusCode !== 200 || !result.body) {
      return { data: null, definitive: false }
    }

    const payload = JSON.parse(result.body) as MastodonStatusResponse
    if (!payload || typeof payload !== 'object') {
      return { data: null, definitive: true }
    }

    // 1. Status identity check: verify that the returned status matches what was requested
    const requestedIdMatches =
      payload.id === mastodonStatusId ||
      (typeof payload.uri === 'string' && payload.uri === statusId) ||
      (typeof payload.url === 'string' && payload.url === statusUrl)

    if (!requestedIdMatches) {
      logger.warn({
        message: 'Mastodon status ID mismatch in animation metadata lookup',
        domain,
        requestedStatusId: mastodonStatusId,
        returnedId: payload.id,
        returnedUri: payload.uri
      })
      return { data: null, definitive: true }
    }

    // 2. Author check: verify attribution
    if (authorId && !isSameAuthor(payload.account, authorId, domain)) {
      logger.warn({
        message: 'Author mismatch in Mastodon animation metadata lookup',
        domain,
        expectedAuthorId: authorId,
        returnedAccountUrl: payload.account?.url ?? null
      })
      return { data: null, definitive: true }
    }

    const mediaList = Array.isArray(payload.media_attachments)
      ? payload.media_attachments
      : []

    const map: Record<string, AnimationMetadataItem> = {}
    for (const item of mediaList) {
      if (!item || typeof item !== 'object') continue
      const isGifv = item.type === 'gifv'
      const isVideo = item.type === 'video'
      if (!isGifv && !isVideo) continue

      const itemPlaybackType: PlaybackType = isGifv ? 'gifv' : 'video'
      const previewUrl =
        typeof item.preview_url === 'string' && item.preview_url.length > 0
          ? item.preview_url
          : null

      const candidates = [item.url, item.remote_url].filter(
        (u): u is string => typeof u === 'string' && u.length > 0
      )

      for (const cand of candidates) {
        const normalized = normalizeUrlForMatch(cand)
        if (normalized) {
          map[normalized] = {
            playbackType: itemPlaybackType,
            previewUrl,
            definitive: true
          }
        }
      }
    }

    return { data: map, definitive: true }
  } catch (error) {
    logger.warn({
      message: 'Failed to fetch Mastodon status animation metadata',
      domain,
      statusId: mastodonStatusId,
      err: toLoggableError(error)
    })
    return { data: null, definitive: false }
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
      statusUrl: statusUrl ?? undefined,
      statusId: statusId ?? undefined,
      authorId: authorId ?? undefined,
      attachmentCount: attachments.length
    },
    async () => {
      const videoAttachments = attachments.filter((att) =>
        att.mediaType?.startsWith('video')
      )
      if (videoAttachments.length === 0) {
        return {}
      }

      const info = extractMastodonStatusInfo(statusUrl, statusId)
      if (!info) {
        return mapAttachments(videoAttachments, null, true)
      }

      const { domain, statusId: mastodonStatusId } = info
      const cacheKey = `${domain}:${mastodonStatusId}`

      const cached = statusMetadataCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return mapAttachments(videoAttachments, cached.data, cached.definitive)
      }

      const isSupported = await isMastodonCompatibleSoftware(domain)
      if (!isSupported) {
        setBoundedCache(cacheKey, null, FAILURE_TTL_MS, true)
        return mapAttachments(videoAttachments, null, true)
      }

      const cachedAfterCheck = statusMetadataCache.get(cacheKey)
      if (cachedAfterCheck && cachedAfterCheck.expiresAt > Date.now()) {
        return mapAttachments(
          videoAttachments,
          cachedAfterCheck.data,
          cachedAfterCheck.definitive
        )
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
            const ttl = result.data ? SUCCESS_TTL_MS : FAILURE_TTL_MS
            setBoundedCache(cacheKey, result.data, ttl, result.definitive)
            return result
          } finally {
            inFlightRequests.delete(cacheKey)
          }
        })()
        inFlightRequests.set(cacheKey, promise)
      }

      const fetchResult = await promise
      return mapAttachments(
        videoAttachments,
        fetchResult.data,
        fetchResult.definitive
      )
    }
  )

const mapAttachments = (
  attachments: Array<{ url: string; mediaType?: string | null }>,
  metadataMap: Record<string, AnimationMetadataItem> | null,
  definitive: boolean = false
): Record<string, AnimationMetadataItem> => {
  const result: Record<string, AnimationMetadataItem> = {}

  for (const attachment of attachments) {
    const normalized = normalizeUrlForMatch(attachment.url)
    const match = metadataMap ? metadataMap[normalized] : undefined

    if (match) {
      result[attachment.url] = {
        ...match,
        definitive: true
      }
    } else {
      result[attachment.url] = {
        playbackType: 'unknown',
        previewUrl: null,
        definitive
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
      if (match && (match.playbackType !== 'unknown' || match.definitive)) {
        attachment.playbackType = match.playbackType
        if (!attachment.thumbnailUrl && match.previewUrl) {
          attachment.thumbnailUrl = match.previewUrl
        }

        if (database) {
          await database.updateAttachmentPlayback({
            id: attachment.id,
            playbackType: match.playbackType,
            thumbnailUrl: attachment.thumbnailUrl ?? null,
            onlyIfUnset: true
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

export const BATCH_ANIMATION_METADATA_CONCURRENCY = 4
export const MAX_BATCH_ANIMATION_METADATA_LOOKUPS = 20
export const BATCH_ANIMATION_METADATA_TIMEOUT_MS = 6000

export const enrichStatusesAttachments = async (
  statuses: Status[],
  database?: MediaDatabase
): Promise<Status[]> => {
  if (!statuses || statuses.length === 0) {
    return statuses
  }

  // 1. Collect unique Note/Poll targets from displayed statuses and Announce originals
  const targetMap = new Map<
    string,
    {
      primary: StatusNote | StatusPoll
      all: Array<StatusNote | StatusPoll>
    }
  >()

  for (const status of statuses) {
    const original = getOriginalStatus(status)
    if (
      (original.type === StatusType.enum.Note ||
        original.type === StatusType.enum.Poll) &&
      original.attachments &&
      original.attachments.length > 0
    ) {
      const existing = targetMap.get(original.id)
      if (existing) {
        existing.all.push(original)
      } else {
        targetMap.set(original.id, { primary: original, all: [original] })
      }
    }
  }

  // 2. Filter candidates that have video attachments needing resolution
  const candidates: Array<{
    primary: StatusNote | StatusPoll
    all: Array<StatusNote | StatusPoll>
    needsResolution: Attachment[]
  }> = []

  for (const entry of targetMap.values()) {
    const needsResolution = entry.primary.attachments.filter(
      (att) => att.mediaType.startsWith('video') && !att.playbackType
    )
    if (needsResolution.length > 0) {
      candidates.push({ ...entry, needsResolution })
    }
  }

  if (candidates.length === 0) {
    return statuses
  }

  // 3. Bound total lookup work
  const boundedCandidates = candidates.slice(
    0,
    MAX_BATCH_ANIMATION_METADATA_LOOKUPS
  )

  // 4. Enrich each candidate with in-memory stale guards and optimistic DB updates
  const enrichCandidate = async (candidate: (typeof boundedCandidates)[0]) => {
    try {
      const { primary, all, needsResolution } = candidate
      const resolved = await resolveAnimationMetadata({
        statusUrl: primary.url,
        statusId: primary.id,
        authorId: primary.actorId,
        attachments: needsResolution.map((att) => ({
          url: att.url,
          mediaType: att.mediaType
        }))
      })

      for (const attachment of needsResolution) {
        // In-memory guard: skip if already classified by another concurrent task
        if (attachment.playbackType) continue

        const match = resolved[attachment.url]
        if (match && (match.playbackType !== 'unknown' || match.definitive)) {
          const resolvedPlayback = match.playbackType
          const previewUrl = match.previewUrl

          // Update primary attachment
          attachment.playbackType = resolvedPlayback
          if (!attachment.thumbnailUrl && previewUrl) {
            attachment.thumbnailUrl = previewUrl
          }

          // Propagate to any duplicate references/instances of the original Note/Poll
          for (const duplicate of all) {
            if (duplicate === primary) continue
            const dupAtt = duplicate.attachments.find(
              (a) => a.id === attachment.id
            )
            if (dupAtt && !dupAtt.playbackType) {
              dupAtt.playbackType = resolvedPlayback
              if (!dupAtt.thumbnailUrl && previewUrl) {
                dupAtt.thumbnailUrl = previewUrl
              }
            }
          }

          // Persist to database with stale-write guard (onlyIfUnset: true)
          if (database) {
            await database.updateAttachmentPlayback({
              id: attachment.id,
              playbackType: resolvedPlayback,
              thumbnailUrl: attachment.thumbnailUrl ?? null,
              onlyIfUnset: true
            })
          }
        }
      }
    } catch (error) {
      logger.warn({
        message: 'Failed to enrich status attachments in batch',
        statusId: candidate.primary.id,
        err: toLoggableError(error)
      })
    }
  }

  // 5. Execute with concurrency bound, wrapped in a batch timeout
  const runBatch = async () => {
    await mapWithConcurrency(
      boundedCandidates,
      BATCH_ANIMATION_METADATA_CONCURRENCY,
      enrichCandidate
    )
  }

  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        logger.warn({
          message: 'Batch animation metadata enrichment timed out'
        })
        resolve()
      }, BATCH_ANIMATION_METADATA_TIMEOUT_MS)
    })

    await Promise.race([runBatch(), timeoutPromise])
    if (timeoutId) clearTimeout(timeoutId)
  } catch (error) {
    logger.warn({
      message: 'Unexpected error during batch animation metadata enrichment',
      err: toLoggableError(error)
    })
  }

  return statuses
}
